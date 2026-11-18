//! pool.rs — a small render pool of background host processes.
//!
//! The interactive host stays the only session-bearing engine. Pool workers
//! are additional `spektralab-host` children used for independent batch work
//! (`export_frame` with a private source, thumbnails, proofs): each request is
//! self-contained, so every worker can render a different photograph without
//! any shared session state. The pool is created on demand and shut down when
//! the batch ends so the extra GPU memory is returned before editing resumes.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Wry};

use crate::host::HostManager;

/// More workers than this are never useful on a workstation GPU and each one
/// costs a full host process plus engine allocations.
pub const MAX_WORKERS: usize = 4;
const READY_TIMEOUT: Duration = Duration::from_secs(60);

pub struct HostPool {
    workers: Mutex<Vec<Arc<HostManager>>>,
    /// Serialises `ensure` calls; starting two workers for one request would
    /// duplicate processes and their GPU allocations.
    gate: tokio::sync::Mutex<()>,
}

impl HostPool {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { workers: Mutex::new(Vec::new()), gate: tokio::sync::Mutex::new(()) })
    }

    fn snapshot(&self) -> Vec<Arc<HostManager>> {
        self.workers.lock().unwrap().clone()
    }

    fn states_of(workers: &[Arc<HostManager>]) -> Value {
        let states: Vec<Value> = workers
            .iter()
            .enumerate()
            .map(|(index, w)| {
                json!({
                    "index": index,
                    "busy": w.is_busy(),
                    "state": w.state(),
                    "diagnostics": w.diagnostics(),
                })
            })
            .collect();
        json!({ "workers": workers.len(), "max": MAX_WORKERS, "states": states })
    }

    pub fn states(&self) -> Value {
        Self::states_of(&self.snapshot())
    }

    pub fn worker(&self, index: usize) -> Option<Arc<HostManager>> {
        self.snapshot().get(index).cloned()
    }

    /// Make sure `count` workers exist and are ready. Returns the pool state.
    pub async fn ensure(&self, app: &AppHandle<Wry>, count: usize) -> Result<Value, String> {
        let count = count.min(MAX_WORKERS);
        let _gate = self.gate.lock().await;
        let existing = self.snapshot().len();
        if count > existing {
            for index in existing..count {
                let manager = HostManager::new_named(app.clone(), &format!("pool-{index}"), true);
                tauri::async_runtime::spawn(manager.start());
                self.workers.lock().unwrap().push(manager);
            }
        } else if count < existing {
            // Shrinking is done explicitly by `shutdown`; leave the surplus
            // workers idle rather than tearing a pool down mid-batch.
        }
        let workers = self.snapshot();
        let wanted = &workers[..count];
        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            let mut pending = 0usize;
            for w in wanted {
                match w.state().get("phase").and_then(Value::as_str).unwrap_or("") {
                    "ready" => {}
                    "failed" => {
                        let reason = w.state().get("reason").and_then(Value::as_str).unwrap_or("the engine host failed to start").to_string();
                        return Err(format!("pool worker failed to start: {reason}"));
                    }
                    _ => pending += 1,
                }
            }
            if pending == 0 {
                return Ok(Self::states_of(wanted));
            }
            if Instant::now() >= deadline {
                return Err(format!("{pending} pool worker(s) did not become ready in {} s", READY_TIMEOUT.as_secs()));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    /// Restart one worker after a crash, keeping the pool shape.
    pub async fn restart(&self, index: usize) -> Result<(), String> {
        let worker = self.worker(index).ok_or_else(|| format!("no pool worker {index}"))?;
        worker.restart().await;
        Ok(())
    }

    /// Stop every worker. `ensure` can build a fresh pool afterwards.
    pub async fn shutdown(&self) {
        let workers = { std::mem::take(&mut *self.workers.lock().unwrap()) };
        for worker in workers {
            let _ = tokio::time::timeout(Duration::from_secs(5), worker.shutdown()).await;
        }
    }
}
