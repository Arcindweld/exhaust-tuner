//! sin, cos, tan and acos from the same C library Python's math module calls, so the core's numbers match the
//! add-in's Python to the last digit. Rust's f64::sin and the rest call the platform's C library on Linux (glibc),
//! macOS and the MSVC build (the Universal C Runtime), which is what Python uses there too. The GNU build for Windows
//! (cross-compiled with MinGW or zig) would take them from MinGW's own maths instead, which differs from the UCRT by
//! a unit in the last place now and then, so that build imports them from the UCRT by name.

#[cfg(all(windows, target_env = "gnu"))]
mod ucrt {
    // raw-dylib: the import comes from this declaration (no import library needed), and the calls go through the
    // DLL's import table, so a sin compiled into the binary from elsewhere cannot stand in for it.
    #[link(name = "api-ms-win-crt-math-l1-1-0", kind = "raw-dylib")]
    extern "C" {
        pub fn sin(x: f64) -> f64;
        pub fn cos(x: f64) -> f64;
        pub fn tan(x: f64) -> f64;
        pub fn acos(x: f64) -> f64;
    }
}

#[cfg(all(windows, target_env = "gnu"))]
mod imp {
    pub fn sin(x: f64) -> f64 {
        unsafe { super::ucrt::sin(x) }
    }
    pub fn cos(x: f64) -> f64 {
        unsafe { super::ucrt::cos(x) }
    }
    pub fn tan(x: f64) -> f64 {
        unsafe { super::ucrt::tan(x) }
    }
    pub fn acos(x: f64) -> f64 {
        unsafe { super::ucrt::acos(x) }
    }
}

#[cfg(not(all(windows, target_env = "gnu")))]
mod imp {
    pub fn sin(x: f64) -> f64 {
        x.sin()
    }
    pub fn cos(x: f64) -> f64 {
        x.cos()
    }
    pub fn tan(x: f64) -> f64 {
        x.tan()
    }
    pub fn acos(x: f64) -> f64 {
        x.acos()
    }
}

pub use imp::{acos, cos, sin, tan};
