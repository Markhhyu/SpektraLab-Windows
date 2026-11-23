#include "spektrafilm/spk_engine.h"
#include "json.hpp"
#include <array>
#include <cmath>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using Session = std::unique_ptr<spk_session, decltype(&spk_session_release)>;
void require(bool ok, const std::string& reason) {
    if (!ok) throw std::runtime_error(reason + " " + spk_last_error(nullptr));
}
spk::Json meter(spk_session* s) {
    char* report = nullptr;
    require(spk_solve(s,"exposure",&report)==SPK_OK,"solve");
    std::unique_ptr<char,decltype(&spk_string_free)> text(report,spk_string_free);
    spk::Json parsed; std::string error;
    require(spk::Json::parse(report,parsed,error),error);
    return parsed.at("exposure_ev_by_method");
}
std::vector<uint16_t> render(spk_session* s, const char* tier) {
    spk_result out{};
    require(spk_render(s,tier,&out)==SPK_OK,"render");
    std::vector<uint16_t> pixels;
    for (uint32_t y=0;y<out.height;++y) {
        const auto* row=out.rgba16+4*size_t(y)*out.row_stride_px;
        pixels.insert(pixels.end(),row,row+4*out.width);
    }
    spk_result_free(&out);
    require(!pixels.empty(),"empty render");
    return pixels;
}
void metering(spk_engine* engine) {
    constexpr unsigned w=100,h=16;
    std::vector<float> wedge(w*h*3);
    for (unsigned i=0;i<w*h;++i) {
        const unsigned x=i%w;
        const float grey=float(.184*std::exp2(x<8 ? -6.0 : x>=92 ? 6.0 : 0.0));
        for (int c=0;c<3;++c) wedge[3*i+c]=grey;
    }
    const spk_image image{wedge.data(),w,h,3};
    Session session(spk_open(engine,&image,nullptr,nullptr),spk_session_release);
    require(bool(session),"open wedge");
    const auto legacy=meter(session.get());
    require(std::abs(legacy.at("protect_highlights").as_double()+3.0)<.005 &&
            std::abs(legacy.at("protect_shadows").as_double()-2.0)<.005,"fallback");
    std::array<spk::Json,2> reports;
    const char* stocks[]={"kodak_vision3_50d","kodak_ektachrome_100"};
    for (int i=0;i<2;++i) {
        const std::string delta=std::string("{\"film_stock\":\"")+stocks[i]+"\"}";
        require(spk_set_params(session.get(),delta.c_str(),nullptr)==SPK_OK,"switch stock");
        reports[i]=meter(session.get());
        Session fresh(spk_open(engine,&image,delta.c_str(),nullptr),spk_session_release);
        require(bool(fresh) && reports[i].dump()==meter(fresh.get()).dump(),"cached versus fresh meter");
        require(reports[i].at("balanced").as_double()==legacy.at("balanced").as_double(),"balanced changed");
        std::printf("%s %s\n",stocks[i],reports[i].dump().c_str());
    }
    require(reports[0].at("protect_highlights").as_double()>reports[1].at("protect_highlights").as_double()+.5,
            "reversal and negative highlight protection indistinguishable");
    require(reports[0].at("protect_shadows").as_double()!=reports[1].at("protect_shadows").as_double(),
            "shadow protection indistinguishable");
}
void clipped_lamp(spk_engine* engine) {
    const unsigned w=64,h=32;
    std::vector<float> source(w*h*3,.08f), restored;
    std::vector<uint32_t> bits((w*h+31)/32);
    for(unsigned y=12;y<18;++y) for(unsigned x=16;x<22;++x) {
        size_t i=size_t(y)*w+x;
        bits[i/32]|=1u<<(i%32);
        for(int c=0;c<3;++c) source[3*i+c]=1;
    }
    // A stronger, measured HDR source at the opposite end must stay intact.
    for(int c=0;c<3;++c) source[(16*w+55)*3+c]=8;
    restored=source;
    for(size_t i=0;i<w*h;++i) if(bits[i/32] & (1u<<(i%32)))
        for(int c=0;c<3;++c) restored[3*i+c]*=16;
    const spk_image in{source.data(),w,h,3}, expected{restored.data(),w,h,3};
    const char* delta=R"({"film_stock":"cinestill_800t","grain_active":false,"glare_active":false,"auto_exposure":false})";
    Session tagged(spk_open_raw(engine,&in,bits.data(),uint32_t(bits.size()),delta,nullptr),spk_session_release);
    Session hdr(spk_open(engine,&expected,delta,nullptr),spk_session_release);
    Session untagged(spk_open(engine,&in,delta,nullptr),spk_session_release);
    require(tagged && hdr && untagged,"open night scene");
    require(meter(tagged.get()).dump()==meter(untagged.get()).dump(),"clipping changed source meter");
    for (const char* tier : {"live","full"}) {
        auto positive=render(tagged.get(),tier);
        require(positive==render(hdr.get(),tier),"RAW mask disagrees with measured linear HDR");
        require(positive!=render(untagged.get(),tier),"no visible lamp correction");
    }
    require(spk_set_params(tagged.get(),R"({"halation_headroom_ev":0})",nullptr)==SPK_OK,"disable headroom");
    require(render(tagged.get(),"full")==render(untagged.get(),"full"),"zero EV bypass");
}
}
int main(int argc,char** argv) {
    try {
        if(argc!=2) return 2;
        std::unique_ptr<spk_engine,decltype(&spk_engine_destroy)> engine(spk_engine_create(argv[1],nullptr),spk_engine_destroy);
        require(bool(engine),"engine");
        metering(engine.get());
        clipped_lamp(engine.get());
        return 0;
    } catch(const std::exception& e) {std::fprintf(stderr,"%s\n",e.what());return 1;}
}
