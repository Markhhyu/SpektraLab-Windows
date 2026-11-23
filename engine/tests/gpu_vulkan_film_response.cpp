// Small-signal MTF in developed layer density, before paper, scan and grain.
#include "pipeline/pipeline.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <memory>
#include <numbers>
#include <stdexcept>
#include <vector>

namespace {
constexpr unsigned width = 7200, height = 8;
constexpr double film_mm = 36.0, midgrey = 0.184;
constexpr std::array<int,9> frequencies = {3,5,10,15,20,25,30,35,40};
// Kodak VISION3 50D brochure, p.2, RGB curves digitised relative to 3 cy/mm.
constexpr double target[][3] = {{1,1,1},{.982,.978,.968},{1.014,1.012,.959},
    {.985,1.001,.850},{.857,.898,.740},{.728,.787,.643},{.611,.688,.569},
    {.513,.608,.513},{.435,.543,.469}};
using Response = std::array<std::array<double,3>, frequencies.size()>;

// Log spectral products tabulated at 10 nm, interpolated in log space on
// the profile grid. Numeric reference: Jan Lohse, spectral_film_lut,
// src/spectral_film_lut/densiometry.py (STATUS_A / STATUS_M). Optical density
// uses the spectral transmittance including the actual film base.
struct Band { int start_nm; std::vector<double> log_weight; };
using Triple = std::array<double,3>;
class Densitometer {
public:
    Densitometer(const spk::Profile& film) : film_(film) {
        static const Band Ar{600, {2.568, 4.638, 5, 4.871, 4.604, 4.286, 3.9, 3.551, 3.165, 2.776, 2.383, 1.97, 1.551, 1.141, 0.741, 0.341}};
        static const Band Ag{500, {1.65, 3.822, 4.782, 5, 4.906, 4.644, 4.221, 3.609, 2.766, 1.579}};
        static const Band Ab{420, {3.602, 4.819, 5, 4.912, 4.62, 4.04, 2.989, 1.566, 0.165}};
        static const Band Mr{620, {2.109, 4.479, 5, 4.899, 4.578, 4.252, 3.875, 3.491, 3.099, 2.687, 2.269, 1.859, 1.449, 1.054, 0.654, 0.254}};
        static const Band Mg{470, {1.152, 2.207, 3.156, 3.804, 4.272, 4.626, 4.872, 5, 4.995, 4.818, 4.458, 3.915, 3.172, 2.239, 1.07}};
        static const Band Mb{410, {2.103, 4.111, 4.632, 4.871, 5, 4.955, 4.743, 4.343, 3.743, 2.99, 1.852}};
        const std::array<const Band*,3> bands = film.info.is_positive() ?
            std::array<const Band*,3>{&Ar,&Ag,&Ab} : std::array<const Band*,3>{&Mr,&Mg,&Mb};
        weights_.resize(film.data.wavelengths.size());
        for (size_t i=0;i<weights_.size();++i) {
            bool valid=std::isfinite(film.data.base_density[i]);
            for(int c=0;c<3;++c) valid &= std::isfinite(film.data.channel_density[3*i+c]);
            if (!valid) continue;
            for (int c=0;c<3;++c) {
                const auto& band=*bands[c];
                double x=(film.data.wavelengths[i]-band.start_nm)/10.0;
                if (x<0 || x>double(band.log_weight.size()-1)) continue;
                const size_t lo=size_t(x), hi=std::min(lo+1,band.log_weight.size()-1);
                weights_[i][c]=std::pow(10.0,std::lerp(band.log_weight[lo],band.log_weight[hi],x-lo));
                mass_[c]+=weights_[i][c];
            }
        }
    }
    Triple read(const float* dye) const {
        Triple transmission{};
        for (size_t i=0;i<weights_.size();++i) {
            const auto& w=weights_[i];
            if(w[0]+w[1]+w[2]==0) continue;
            double d=film_.data.base_density[i];
            for(int c=0;c<3;++c) d+=dye[c]*film_.data.channel_density[3*i+c];
            const double t=std::pow(10.0,-d);
            for(int c=0;c<3;++c) transmission[c]+=t*w[c];
        }
        for (int c=0;c<3;++c) transmission[c]=-std::log10(transmission[c]/mass_[c]);
        return transmission;
    }
private:
    const spk::Profile& film_;
    std::vector<Triple> weights_;
    Triple mass_{};
};

// A 37-patch neutral wedge at the negative/slide tap. Keep the entire optical
// output chain out of the comparison. Positive and negative material have
// opposite density slopes and can flatten at either end of the wedge.
void exposure_wedge(spk::gpu::Gpu* gpu,spk::Colour& colour,spk::Blob& blob,spk::SetupCache& cache,
                    const std::string& resources,const char* stock) {
    spk::Params params;
    std::string error;
    if (!spk::init_params(resources,stock,"kodak_2383",spk::Json::object(),params,error))
        throw std::runtime_error(error);
    params.debug.deactivate_spatial_effects=true;
    params.debug.deactivate_stochastic_effects=true;
    params.camera.auto_exposure=false;
    params.camera.exposure_baseline_ev=0;
    params.io.input_cctf_decoding=false;
    if (!spk::digest(params,spk::Json::object(),error)) throw std::runtime_error(error);
    spk::Pipeline pipe(gpu,&colour,&blob,&cache);
    if (!pipe.build(params,error)) throw std::runtime_error(error);
    constexpr int count=37;
    std::array<float,count*3> data{};
    for(int i=0;i<count;++i) for(int c=0;c<3;++c)
        data[3*i+c]=float(midgrey*std::exp2((i-18)/3.0));
    gpu->begin_frame();
    spk::Image src{},density{};
    src.w=count; src.h=1; src.c=3;
    src.buf=gpu->upload(data.data(),sizeof data,error);
    pipe.set_source_shape(count,1,count,1);
    if (!src.buf || !pipe.run_film(src,density,nullptr,error) || !gpu->flush(error) ||
        !gpu->read(density.buf.get(),0,data.data(),sizeof data,error)) throw std::runtime_error(error);
    gpu->end_frame();
    const Densitometer meter(params.film);
    // Digitised from Kodak E-4000 p.3. Hold out -3, -1 and +1 EV.
    // The fixed common axis origin is log H = -0.8004 at neutral grey.
    const double reversal[][3]={{2.288,2.437,2.361},{1.125,1.163,1.097},{.429,.432,.391}};
    // 50D brochure p.2, manufacturer's 18-percent reference at 0 EV.
    const double negative[][3]={{.482,.927,1.195},{.780,1.268,1.518},{1.085,1.634,1.866}};
    const int sign=params.film.info.is_positive() ? -1 : 1;
    for(int i=0;i<count;++i) {
        const Triple optical=meter.read(&data[3*i]);
        if (i==9 || i==15 || i==21) {
            for (int c=0;c<3;++c) {
                const double expected=(sign<0 ? reversal : negative)[(i-9)/6][c];
                if (!std::isfinite(optical[c]) || std::abs(optical[c]-expected)>.085)
                    throw std::runtime_error(std::string(stock)+" exceeds Kodak neutral-wedge tolerance: "+
                                             std::to_string(optical[c])+" vs "+std::to_string(expected));
            }
        }
        std::printf("wedge %s %.6f %.6f %.6f %.6f\n",stock,(i-18)/3.0,data[i*3],data[i*3+1],data[i*3+2]);
        for(int c=0;c<3;++c) {
            if (!std::isfinite(data[3*i+c]) || (i && sign*(data[3*i+c]-data[3*(i-1)+c]) < -.005))
                throw std::runtime_error("neutral wedge reverses direction");
            if (i==21 && sign*(data[3*i+c]-data[3*15+c])<.1)
                throw std::runtime_error("missing mid-grey contrast");
        }
    }
}

Response measure(spk::gpu::Gpu* gpu, spk::Pipeline& pipeline, const Densitometer& meter, unsigned w) {
    std::string error;
    std::vector<float> data(size_t(w)*height*3);
    const double phase = 2*std::numbers::pi*film_mm/double(w);
    for (unsigned x=0; x<w; ++x) {
        double value=1.0;
        for (int f : frequencies) value += .0015*std::cos(phase*f*x);
        for (unsigned y=0; y<height; ++y)
            for (unsigned c=0; c<3; ++c) data[3*(size_t(y)*w+x)+c]=float(midgrey*value);
    }
    gpu->begin_frame();
    spk::Image input{}, density{};
    input.w=w; input.h=height; input.c=3;
    input.buf=gpu->upload(data.data(),data.size()*sizeof(float),error);
    pipeline.set_source_shape(w,height,w,height);
    if (!input.buf || !pipeline.run_film(input,density,nullptr,error) || !gpu->flush(error) ||
        !gpu->read(density.buf.get(),0,data.data(),data.size()*sizeof(float),error))
        throw std::runtime_error(error);
    gpu->end_frame();
    std::vector<Triple> optical(w);
    for(unsigned x=0;x<w;++x) optical[x]=meter.read(&data[3*(size_t(height/2)*w+x)]);
    Response result{};
    // Omit 3 mm at either edge. The remaining 30 mm contains integer periods.
    for (size_t i=0; i<frequencies.size(); ++i) {
        double a[3]{}, b[3]{};
        for (unsigned x=w/12; x<w-w/12; ++x) {
            const double angle=phase*frequencies[i]*x;
            for (unsigned c=0; c<3; ++c) {
                double d=optical[x][c];
                a[c]+=d*std::cos(angle); b[c]+=d*std::sin(angle);
            }
        }
        for (unsigned c=0; c<3; ++c) result[i][c]=std::hypot(a[c],b[c]);
    }
    const auto low=result.front();
    for (auto& row : result) for (unsigned c=0; c<3; ++c) {
        if (!(low[c]>0 && std::isfinite(row[c]))) throw std::runtime_error("invalid density modulation");
        row[c]/=low[c];
    }
    return result;
}
}
int main(int argc, char** argv) {
    try {
        if (argc!=2) return 2;
        const std::string resources=argv[1];
        std::string error;
        std::unique_ptr<spk::gpu::Gpu> gpu(spk::gpu::Gpu::create_vulkan(resources+"/vulkan",error));
        if (!gpu) throw std::runtime_error(error);
        spk::Blob blob; spk::Colour colour; spk::SetupCache cache; spk::Params params;
        if (!blob.open(resources+"/spektrafilm_constants.bin",error) || !colour.init(blob,error) ||
            !spk::init_params(resources,"kodak_vision3_50d","kodak_2383",spk::Json::object(),params,error))
            throw std::runtime_error(error);
        for (const char* stock : {"kodak_vision3_50d","kodak_ektachrome_100"})
            exposure_wedge(gpu.get(),colour,blob,cache,resources,stock);
        params.camera.auto_exposure=false;
        params.camera.film_format_mm=film_mm;
        params.camera.lens_blur_um=0;
        params.film_render.grain.active=false;
        params.io.input_cctf_decoding=false;
        params.io.input_color_space="ProPhoto RGB";
        spk::Pipeline pipe(gpu.get(),&colour,&blob,&cache);
        if (!pipe.build(params,error)) throw std::runtime_error(error);
        const Densitometer meter(params.film);
        spk::Params previous=params;
        const spk::HalationParams generic;
        std::copy_n(generic.scatter_core_um,3,previous.film_render.halation.scatter_core_um);
        std::copy_n(generic.scatter_tail_weight,3,previous.film_render.halation.scatter_tail_weight);
        spk::Pipeline baseline(gpu.get(),&colour,&blob,&cache);
        if (!baseline.build(previous,error)) throw std::runtime_error(error);
        bool passed=true;
        for(unsigned w : {width, 5400u, 9000u}) {
            auto result=measure(gpu.get(),pipe,meter,w);
            auto before=measure(gpu.get(),baseline,meter,w);
            double old_sum=0, new_sum=0;
            for(size_t i=0;i<frequencies.size();++i) {
                const auto& row=result[i];
                std::printf("%u %d %.5f %.5f %.5f\n",w,frequencies[i],row[0],row[1],row[2]);
                for(unsigned c=0;c<3;++c) {
                    if (std::abs(row[c]-target[i][c])>.07) passed=false;
                    old_sum+=std::pow(before[i][c]-target[i][c],2);
                    new_sum+=std::pow(row[c]-target[i][c],2);
                }
            }
            const double n=3*(frequencies.size()-1);
            std::printf("MTF RMS %u %.5f %.5f\n",w,std::sqrt(old_sum/n),std::sqrt(new_sum/n));
            passed &= new_sum < .75*.75*old_sum;
        }
        return passed?0:1;
    } catch (const std::exception& e) {std::fprintf(stderr,"%s\n",e.what());return 1;}
}
