//! Cell offsets at Chebyshev distance exactly k, in router.py's _shell order, made once per k and shared.

use std::cell::RefCell;
use std::rc::Rc;

fn make(k: i64) -> Vec<(i64, i64, i64)> {
    if k == 0 {
        return vec![(0, 0, 0)];
    }
    let mut s = Vec::with_capacity(((2 * k + 1).pow(3) - (2 * k - 1).pow(3)) as usize);
    for dx in -k..=k {
        for dy in -k..=k {
            if dx.abs() == k || dy.abs() == k {
                for dz in -k..=k {
                    s.push((dx, dy, dz));
                }
            } else {
                s.push((dx, dy, -k));
                s.push((dx, dy, k));
            }
        }
    }
    s
}

thread_local! {
    static SHELLS: RefCell<Vec<Rc<Vec<(i64, i64, i64)>>>> = const { RefCell::new(Vec::new()) };
}

/// The shell at distance k (k < 0 gives the k = 0 shell).
pub fn shell(k: i64) -> Rc<Vec<(i64, i64, i64)>> {
    let k = k.max(0) as usize;
    SHELLS.with(|c| {
        let mut v = c.borrow_mut();
        while v.len() <= k {
            let n = v.len() as i64;
            v.push(Rc::new(make(n)));
        }
        v[k].clone()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_order() {
        for k in 0..7i64 {
            let n = shell(k).len() as i64;
            let want = if k == 0 { 1 } else { (2 * k + 1).pow(3) - (2 * k - 1).pow(3) };
            assert_eq!(n, want);
        }
        let s1 = shell(1);
        assert_eq!(s1[0], (-1, -1, -1)); // router.py: dx = -1 row first, dz walking -1..1
        assert_eq!(s1[2], (-1, -1, 1));
    }
}
