//! The program's icon as resource 1 of ExhaustTuner.exe (the window and Explorer show it). Only for Windows;
//! a cross-check from another system without a resource compiler goes on without it.
fn main() {
    println!("cargo:rerun-if-changed=app.rc");
    println!("cargo:rerun-if-changed=../../app/ExhaustTuner.Desktop/exhaust.ico");
    println!("cargo:rerun-if-env-changed=EXHAUST_TUNER_VERSION");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let _ = embed_resource::compile("app.rc", embed_resource::NONE);
    }
}
