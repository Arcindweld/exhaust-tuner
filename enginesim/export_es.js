'use strict';
/**
 * export_es.js — export a design from the exhaust/intake calculator as an
 * Engine Simulator (.mr) engine script, for a ROUGH LISTENING PREVIEW only.
 *
 * Engine Simulator is used here as a reference/example, not as an accurate
 * acoustic model (see NOTES.md for what it does and does not model).
 *
 * Every number written to the .mr file is one of:
 *   [spec]    taken from the calculator spec (unit-converted only),
 *   [derived] computed from spec values with a formula stated in the comment
 *             (where engine-sim's own formula is used, the C++ file:line is cited),
 *   [donor]   copied from a shipped Engine Simulator example engine
 *             (Engine Simulator Community Edition v0.1.14a, file:line cited),
 *   [default] left out, so engine-sim's own default in es/objects/objects.mr applies.
 *
 * Target: Engine Simulator Community Edition v0.1.14a (the default).  The file uses
 * only script constructs that exist with identical signatures in both CE v0.1.14a and
 * the open-source upstream (ange-yaghi/engine-sim @ 85f7c3b); the only difference
 * between targets is the trailing `main()` call (see options.target).
 *
 * Spec (all lengths in mm, angles in degrees):
 * {
 *   name: 'My engine',
 *   cylinders: 8,                       // alias: cyl, cylCount
 *   layout: 'inline' | 'V' | 'flat',
 *   bankAngle_deg: 90,                  // V only (alias: bankAngle). flat = 180.
 *   cylNumbering: 'alternate',          // V/flat: 'alternate' (odd = bank A, GM/Chrysler)
 *                                       //         or 'sequential' (1..n/2 = bank A, Ford/VAG)
 *   bore_mm, stroke_mm, rod_mm, cr,
 *   firingOrder: [1, 8, 4, 3, 6, 5, 7, 2],
 *   firingAngles_deg: [0, 90, ...],     // optional: crank angle of each firing event in
 *                                       // firingOrder order (odd-fire). Default even-fire.
 *   redline_rpm, idle_rpm,
 *   cam: { ivo, ivc, evo, evc,          // timing-card convention: IVO deg BTDC, IVC deg ABDC,
 *                                       // EVO deg BBDC, EVC deg ATDC, measured at checkLift_mm
 *          liftIn_mm, liftEx_mm,        // VALVE lift (engine-sim has no rocker ratio)
 *          checkLift_mm: 1.27 },        // optional, default 0.050 in
 *   intake:  { runnerL_mm, runnerD_mm, plenumL },
 *   exhaust: { primaryL_mm,             // number, or array indexed by cylinder number - 1
 *              primaryD_mm, collectorD_mm,
 *              systemL_mm,              // collector to tip
 *              tipD_mm, dual,
 *              grouping: 'bank' | '180',   // dual V8: per bank, or 180-degree pairs (alternate cylinders in the order)
 *              impulseResponse: 'mild_exhaust_0' }  // optional, an es ir_lib entry
 * }
 *
 * Options:
 *   target:           'ce' (default) | 'upstream' | 'fork' (Arcindweld/engine-sim with the 1-D exhaust: same as upstream plus the pipe geometry)
 *   donor:            'auto' (default) | 'trx520' | 'ej25' | 'gm_ls'
 *   flowCoefficients: 'example' (default) | 'geometric'
 *     'example' copies the donor engine's orifice ratings for the runner, primary and outlet, as the
 *     shipped engines are tuned; 'geometric' uses ideal (Cd = 1) orifices of the spec's diameters, which
 *     on a dyno pull in Engine Simulator v0.1.14a gave 913 hp for a mild 350 V8 against 521 hp with the
 *     donor ratings (the intake runner coefficient is what drives it; the outlet size barely matters).
 *   useLibraryParts:  true (default): use es/part-library builders when they match exactly
 */

// ---------------------------------------------------------------------------
// engine-sim constants (upstream include/units.h, include/constants.h) used to
// reproduce GasSystem::k_carb() exactly (src/gas_system.cpp:131-181).
// ---------------------------------------------------------------------------
const ES = {
    R: 8.31446261815324,                 // constants.h:7
    atm: 101.325e3,                      // units.h:70
    inHg: 3386.3886666666713,            // units.h:77
    scfm: 0.002641 * 453.59237 / 60.0,   // units.h:60 (mol/s)
    T25C: 273.15 + 25.0,                 // units::celcius(25)
    hcr: 1.0 + 2.0 / 5,                  // GasSystem::heatCapacityRatio(5)
    airMolarMass: 28.97e-3,              // units.h:178 AirMolecularMass (kg/mol)
    h50: 0.050 * 25.4,                   // mm, the "50 thou" in harmonic_cam_lobe
};

/** GasSystem::flowConstant (gas_system.cpp:131-161), SI units. */
function flowConstant(targetFlow, P, pressureDrop, T, hcr) {
    const p0 = P, pT = P - pressureDrop;
    const chokedLimit = Math.pow(2.0 / (hcr + 1), hcr / (hcr - 1));
    const r = pT / p0;
    let f;
    if (r <= chokedLimit) {
        f = Math.sqrt(hcr) * Math.pow(2 / (hcr + 1), (hcr + 1) / (2 * (hcr - 1)));
    } else {
        f = Math.sqrt((2 * hcr) / (hcr - 1) * (1 - Math.pow(r, (hcr - 1) / hcr))) * Math.pow(r, 1 / hcr);
    }
    f *= p0 / Math.sqrt(ES.R * T);
    return targetFlow / f;
}

/** GasSystem::k_carb(scfm) — flow coefficient rated at 1.5 inHg depression. */
function kCarb(scfm) {
    return flowConstant(scfm * ES.scfm, ES.atm, 1.5 * ES.inHg, ES.T25C, ES.hcr);
}

/**
 * engine-sim's flow coefficient is an effective orifice area divided by sqrt(molar
 * mass): GasSystem::flowRate (gas_system.cpp:183-229) is the textbook compressible
 * orifice equation with Cd*A/sqrt(M) folded into k.  For an ideal orifice (Cd = 1)
 * of area A, k = A / sqrt(M_air).  Returned as the equivalent k_carb() rating so the
 * .mr file reads like engine-sim's own engines.
 */
function kCarbScfmForArea(area_m2) {
    const k = area_m2 / Math.sqrt(ES.airMolarMass);
    return k / kCarb(1.0);
}

const circleArea_m2 = (d_mm) => Math.PI * Math.pow(d_mm / 2000, 2);

// ---------------------------------------------------------------------------
// Donor values copied from Engine Simulator example engines. Every value used is the
// one in the MIT-licensed upstream repo (ange-yaghi/engine-sim @ 85f7c3b); line numbers
// are the same in CE v0.1.14a for every cited line except the GM LS transmission block.
// Paths are relative to the repo root (or the CE release folder, engine-sim-v0.1.14a/).
// ---------------------------------------------------------------------------
const DONORS = {
    trx520: {
        file: 'assets/engines/atg-video-1/01_honda_trx520.mr',
        what: 'Honda TRX520 single (518 cc ATV)',
        style: 'small',   // head = part-library generic_small_engine_head (as the donor does)
        engine: {
            starter_torque: ['50 * units.lb_ft', 17],
            starter_speed: ['500 * units.rpm', 18],
            throttle_gamma: null,
            fuel: ['fuel(max_burning_efficiency: 1.0)', '20-22'],
            hf_gain: ['0.00121', 23], noise: ['0.229', 24], jitter: ['0.42', 25],
            simulation_frequency: ['40000', 26],
        },
        crank: {
            labels: [],
            flywheel_mass: ['5 * units.lb', 33], mass: ['5 * units.lb', 34],
            friction_torque: ['5.0 * units.lb_ft', 35],
            moment_of_inertia: ['0.22986844776863666 * 0.2', 36],
        },
        piston: { mass: ['100 * units.g', 47], compression_height: ['1.0 * units.inch', 48],
                  blowby: ['k_28inH2O(0.1)', 91] },
        rod: { mass: ['100.0 * units.g', 54], moment_of_inertia: ['0.0015884918028487504', 55] },
        intake: {
            plenum_cross_section_area: ['10.0 * units.cm2', 67],
            intake_flow_rate: ['k_carb(100.0)', 68],
            runner_flow_rate: ['k_carb(200.0)', 'objects.mr intake_parameters default (donor sets none)'],
            idle_flow_rate: ['k_carb(0.0)', 69],
            idle_throttle_plate_position: ['0.993', 70],
            velocity_decay: ['0.5', 71],
        },
        exhaust: {
            outlet_flow_rate: ['k_carb(500.0)', 75], primary_flow_rate: ['k_carb(200.0)', 77],
            velocity_decay: ['0.5', 78], audio_volume: ['1.0', 84],
            impulse_response: ['mild_exhaust_0_reverb', 85],
        },
        head: {
            // generic_small_engine_head (es/part-library/parts/heads.mr) with the donor's
            // flow_attenuation; its port volumes default to 100 cc (heads.mr).
            flow_attenuation: ['2.0', 122],
        },
        cam: { gamma: ['1.0', 106], steps: ['100', 108], base_radius: ['500 * units.thou', 114] },
        ignition: {
            timing: [[0, 12], [1000, 12], [2000, 20], [3000, 35], [4000, 35]], timingLines: '128-134',
            limiter_duration: null,
        },
        vehicle: {
            lines: '158-168',
            params: ['mass: 500 * units.kg', 'drag_coefficient: 0.25',
                     'cross_sectional_area: (47 * units.inch) * (47 * units.inch)',
                     'diff_ratio: 3.33', 'tire_radius: 11 * units.inch',
                     'rolling_resistance: 200 * units.N'],
        },
        transmission: { lines: '144-156', max_clutch_torque: '50 * units.lb_ft',
                        gears: [4.0, 3.5, 3.0, 2.5, 2.0] },
    },

    ej25: {
        file: 'assets/engines/atg-video-1/06_subaru_ej25.mr',
        what: 'Subaru EJ25 2.5 L four (forward rotation, standard valvetrain)',
        style: 'flowtable',
        engine: {
            starter_torque: ['70 * units.lb_ft', 121],
            starter_speed: ['500 * units.rpm', 122],
            throttle_gamma: ['2.0', 128],
            fuel: ['fuel(max_turbulence_effect: 2.5, max_burning_efficiency: 0.75)', '124-127'],
            hf_gain: ['0.01', 129], noise: ['1.0', 130], jitter: ['0.5', 131],
            simulation_frequency: ['20000', 132],
        },
        crank: {
            labels: [
                ['crank_mass', '9.39 * units.kg', 142],
                ['flywheel_mass', '6.8 * units.kg', 143],
                ['flywheel_radius', '6 * units.inch', 144],
                ['crank_moment', 'disk_moment_of_inertia(mass: crank_mass, radius: stroke / 2)', '146-148'],
                ['flywheel_moment', 'disk_moment_of_inertia(mass: flywheel_mass, radius: flywheel_radius)', '149-151'],
                ['other_moment', 'disk_moment_of_inertia(mass: 10 * units.kg, radius: 6.0 * units.cm)', '152-154'],
            ],
            flywheel_mass: ['flywheel_mass', 158], mass: ['crank_mass', 159],
            friction_torque: ['1.0 * units.lb_ft', 160],
            moment_of_inertia: ['crank_moment + flywheel_moment + other_moment', '161-162'],
        },
        piston: { mass: ['(414 + 152) * units.g', 179], compression_height: ['1.0 * units.inch', 141],
                  blowby: ['k_28inH2O(0.001)', 234] },
        rod: { mass: ['535 * units.g', 140],
               moment_of_inertia: ['rod_moment_of_inertia(mass: rod_mass, length: rod_length)', '187-190'] },
        intake: {
            plenum_cross_section_area: ['20.0 * units.cm2', 197],
            intake_flow_rate: ['k_carb(800.0)', 198],
            runner_flow_rate: ['k_carb(250.0)', 199],
            idle_flow_rate: ['k_carb(0.0)', 201],
            idle_throttle_plate_position: ['0.9985', 202],
            velocity_decay: ['0.5', 203],
        },
        exhaust: {
            outlet_flow_rate: ['k_carb(1000.0)', 207], primary_flow_rate: ['k_carb(200.0)', 209],
            velocity_decay: ['1.0', 210], audio_volume: ['0.5 * 8', 216],
            impulse_response: ['mild_exhaust_0', 217],
        },
        head: {
            lines: '15-60',
            intake_runner_volume: ['149.6 * units.cc', 19],
            exhaust_runner_volume: ['50.0 * units.cc', 21],
            intakeFlow: [[0, 0], [50, 58], [100, 103], [150, 156], [200, 214], [250, 249],
                         [300, 268], [350, 280], [400, 280], [450, 281]], intakeFlowLines: '29-40',
            exhaustFlow: [[0, 0], [50, 37], [100, 72], [150, 113], [200, 160], [250, 196],
                          [300, 222], [350, 235], [400, 245], [450, 246]], exhaustFlowLines: '42-53',
        },
        cam: { gamma: ['2.0', 286], steps: ['100', 288], base_radius: ['(34.0 / 2) * units.mm', 305] },
        ignition: {
            timing: [[0, 25], [1000, 25], [2000, 30], [3000, 40], [4000, 40]], timingLines: '308-314',
            limiter_duration: ['0.08', 319],
        },
        vehicle: {
            lines: '329-339',
            params: ['mass: 2700 * units.lb', 'drag_coefficient: 0.2',
                     'cross_sectional_area: (66 * units.inch) * (56 * units.inch)',
                     'diff_ratio: 3.9', 'tire_radius: 10 * units.inch',
                     'rolling_resistance: 300 * units.N'],
        },
        transmission: { lines: '341-352', max_clutch_torque: '300 * units.lb_ft',
                        gears: [3.636, 2.375, 1.761, 1.346, 0.971, 0.756] },
    },

    gm_ls: {
        file: 'assets/engines/atg-video-2/07_gm_ls.mr',
        what: 'GM LS 5.3 L cross-plane V8',
        style: 'flowtable',
        turbulenceFn: {
            lines: '129-142',
            samples: [[0.0, '3.0'], [5.0, '1.5 * 5.0'], [10.0, '1.75 * 10.0'], [15.0, '2.0 * 15.0'],
                      [20.0, '2.0 * 20.0'], [25.0, '2.0 * 25.0'], [30.0, '2.0 * 30.0'],
                      [35.0, '2.0 * 35.0'], [40.0, '2.0 * 40.0'], [45.0, '2.0 * 45.0']],
        },
        engine: {
            starter_torque: ['200 * units.lb_ft', 149],
            starter_speed: ['200 * units.rpm', 150],
            throttle_gamma: ['2.0', 152],
            fuel: ['fuel(max_burning_efficiency: 1.0, turbulence_to_flame_speed_ratio: turbulence_to_flame_speed_ratio())', '153-159'],
            hf_gain: ['0.01', 160], noise: ['1.0', 161], jitter: ['0.6', 162],
            simulation_frequency: ['10000', 163],
        },
        crank: {
            labels: [
                ['crank_mass', '60 * units.lb', 173],
                ['flywheel_mass', '30 * units.lb', 174],
                ['flywheel_radius', '8 * units.inch', 175],
                ['crank_moment', '1.5 * disk_moment_of_inertia(mass: crank_mass, radius: stroke)', '177-179'],
                ['flywheel_moment', 'disk_moment_of_inertia(mass: flywheel_mass, radius: flywheel_radius)', '180-182'],
                ['other_moment', 'disk_moment_of_inertia(mass: 1 * units.kg, radius: 1.0 * units.cm)', '183-185'],
            ],
            flywheel_mass: ['flywheel_mass', 190], mass: ['crank_mass', 191],
            friction_torque: ['20.0 * units.lb_ft', 192],
            moment_of_inertia: ['crank_moment + flywheel_moment + other_moment', '193-194'],
        },
        piston: { mass: ['(100) * units.g', 213], compression_height: ['1.0 * units.inch', 172],
                  blowby: ['k_28inH2O(0.0)', 272] },
        rod: { mass: ['50 * units.g', 171],
               moment_of_inertia: ['rod_moment_of_inertia(mass: rod_mass, length: rod_length)', '221-224'] },
        intake: {
            plenum_cross_section_area: ['20.0 * units.cm2', 231],
            intake_flow_rate: ['k_carb(700.0)', 232],
            runner_flow_rate: ['k_carb(100.0)', 233],
            idle_flow_rate: ['k_carb(0.0)', 235],
            idle_throttle_plate_position: ['0.996', 236],
            velocity_decay: ['0.5', 237],
        },
        exhaust: {
            outlet_flow_rate: ['k_carb(1000.0)', 241], primary_flow_rate: ['k_carb(500.0)', 243],
            velocity_decay: ['1.0', 244], audio_volume: ['4.0', 249],
            impulse_response: ['default_0', 251],
        },
        head: {
            lines: '19-74',
            intake_runner_volume: ['149.6 * units.cc', 23],
            exhaust_runner_volume: ['50.0 * units.cc', 25],
            intakeFlow: [[0, 0], [50, 1], [100, 103], [150, 156], [200, 214], [250, 249],
                         [300, 268], [350, 280], [400, 280], [450, 281]], intakeFlowLines: '33-44',
            exhaustFlow: [[0, 0], [50, 1], [100, 72], [150, 113], [200, 160], [250, 196],
                          [300, 222], [350, 235], [400, 245], [450, 246]], exhaustFlowLines: '46-57',
        },
        cam: { gamma: ['1.1', 375], steps: ['256', 377], base_radius: ['1.0 * units.inch', 394] },
        ignition: {
            timing: [[0, 12], [1000, 12], [2000, 20], [3000, 30], [4000, 40], [5000, 40],
                     [6000, 40], [7000, 40], [8000, 40]], timingLines: '397-407',
            limiter_duration: ['0.2', 412],
        },
        vehicle: {
            lines: '426-436 (upstream values; CE-only flex parameters omitted, CE defaults apply)',
            params: ['mass: 1614 * units.kg', 'drag_coefficient: 0.3',
                     'cross_sectional_area: (72 * units.inch) * (50 * units.inch)',
                     'diff_ratio: 3.42', 'tire_radius: 10 * units.inch',
                     'rolling_resistance: 200 * units.N'],
        },
        transmission: { lines: '438-448 (upstream values; CE-only clutch flex parameters omitted)',
                        max_clutch_torque: '500 * units.lb_ft',
                        gears: [2.97, 2.07, 1.43, 1.00, 0.71, 0.57] },
    },
};

const IR_NAMES = ['default_0', 'real_engine_0', 'real_engine_1', 'real_engine_2', 'sharp_0',
    'mild_exhaust_0', 'mild_exhaust_0_reverb', 'minimal_muffling_01', 'minimal_muffling_02',
    'minimal_muffling_03'];   // es/sound-library/impulse_responses.mr (identical in CE and upstream)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function fmt(x, sig = 6) {
    if (!Number.isFinite(x)) throw new Error('non-finite number in export: ' + x);
    if (Number.isInteger(x)) return x.toFixed(1);
    let s = Number(x.toPrecision(sig)).toString();
    if (s.includes('e')) s = x.toFixed(9);
    return s.includes('.') ? s : s + '.0';
}
const deg = (x) => fmt(x) + ' * units.deg';
const mm = (x) => fmt(x) + ' * units.mm';
const src = (donor, line) => `[donor] ${donor.file}:${line}`;

function ident(name) {
    let s = String(name || 'exported_engine').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = 'exported_engine';
    if (/^[0-9]/.test(s)) s = 'e_' + s;
    return s;
}

function mrString(s) {
    return '"' + String(s).replace(/[\\"]/g, '').replace(/[\r\n]+/g, ' ') + '"';
}

function req(obj, key, path) {
    const v = obj[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`spec.${path} must be a finite number`);
    return v;
}

const mod = (a, n) => ((a % n) + n) % n;

// ---------------------------------------------------------------------------
// geometry: banks, firing, journals, lobe centerlines
// ---------------------------------------------------------------------------
function normalize(spec) {
    const n = spec.cylinders ?? spec.cyl ?? spec.cylCount;
    if (!Number.isInteger(n) || n < 1) throw new Error('spec.cylinders must be a positive integer');
    const layout = String(spec.layout || 'inline');
    if (!['inline', 'V', 'flat'].includes(layout)) throw new Error("spec.layout must be 'inline', 'V' or 'flat'");
    let bankAngle = 0;
    if (layout === 'V') {
        bankAngle = spec.bankAngle_deg ?? spec.bankAngle;
        if (typeof bankAngle !== 'number' || !(bankAngle > 0 && bankAngle < 180)) throw new Error('V layout needs 0 < bankAngle_deg < 180');
    }
    if (layout === 'flat') bankAngle = 180;
    if (layout !== 'inline' && n % 2 !== 0) throw new Error('V/flat layouts need an even cylinder count');
    const numbering = spec.cylNumbering || 'alternate';
    if (!['alternate', 'sequential'].includes(numbering)) throw new Error("cylNumbering must be 'alternate' or 'sequential'");

    const fo = spec.firingOrder;
    if (!Array.isArray(fo) || fo.length !== n || [...fo].sort((a, b) => a - b).some((c, i) => c !== i + 1)) {
        throw new Error(`spec.firingOrder must be a permutation of 1..${n}`);
    }
    // engine-sim's cycle angle 0 is cylinder 1 TDC-compression; rotate order to start at 1
    const start = fo.indexOf(1);
    const order = fo.slice(start).concat(fo.slice(0, start));
    let fireAngles;
    if (spec.firingAngles_deg) {
        const fa = spec.firingAngles_deg;
        if (!Array.isArray(fa) || fa.length !== n) throw new Error('firingAngles_deg must have one angle per cylinder');
        const rot = fa.slice(start).concat(fa.slice(0, start));
        fireAngles = rot.map((a) => mod(a - rot[0], 720));
        for (let i = 1; i < n; ++i) if (!(fireAngles[i] > fireAngles[i - 1])) throw new Error('firingAngles_deg must increase in firing order within 720 deg');
    } else {
        fireAngles = order.map((_, i) => (720 / n) * i);
    }
    const phi = {};   // cylinder number -> TDC-compression cycle angle (deg)
    order.forEach((c, i) => { phi[c] = fireAngles[i]; });

    // banks
    let banks;
    if (layout === 'inline') {
        banks = [{ angle: 0, cyls: Array.from({ length: n }, (_, i) => i + 1) }];
    } else {
        const a = [], b = [];
        for (let c = 1; c <= n; ++c) {
            if (numbering === 'alternate') (c % 2 ? a : b).push(c);
            else (c <= n / 2 ? a : b).push(c);
        }
        banks = [{ angle: -bankAngle / 2, cyls: a }, { angle: bankAngle / 2, cyls: b }];
    }
    const alpha0 = banks[0].angle;
    const tdc = 90 + alpha0;  // crankshaft tdc so cylinder 1 is at TDC at cycle angle 0

    // journal angle that puts cylinder c at TDC at cycle angle phi[c]
    // (derivation: crankshaft.cpp:68-77 + piston placement, see NOTES.md)
    const bankOf = {};
    banks.forEach((bk, bi) => bk.cyls.forEach((c) => { bankOf[c] = bi; }));
    const jAngle = (c) => mod(phi[c] + banks[bankOf[c]].angle - alpha0, 360);

    const journals = [];      // {angle, cyls:[]}
    const journalOf = {};
    if (layout === 'inline') {
        banks[0].cyls.forEach((c) => { journalOf[c] = journals.length; journals.push({ angle: jAngle(c), cyls: [c] }); });
    } else {
        banks[0].cyls.forEach((c, k) => {
            const d = banks[1].cyls[k];
            const ja = jAngle(c), jb = jAngle(d);
            if (Math.abs(ja - jb) < 1e-9) {
                journalOf[c] = journalOf[d] = journals.length;
                journals.push({ angle: ja, cyls: [c, d] });
            } else {
                journalOf[c] = journals.length; journals.push({ angle: ja, cyls: [c] });
                journalOf[d] = journals.length; journals.push({ angle: jb, cyls: [d] });
            }
        });
    }
    return { n, layout, bankAngle, numbering, order, phi, banks, bankOf, tdc, journals, journalOf };
}

/** Cam timing-card events -> lobe centers and the harmonic_cam_lobe duration input. */
function camFromEvents(cam, gamma) {
    const ivo = req(cam, 'ivo', 'cam.ivo'), ivc = req(cam, 'ivc', 'cam.ivc');
    const evo = req(cam, 'evo', 'cam.evo'), evc = req(cam, 'evc', 'cam.evc');
    const Lin = req(cam, 'liftIn_mm', 'cam.liftIn_mm'), Lex = req(cam, 'liftEx_mm', 'cam.liftEx_mm');
    const h = cam.checkLift_mm ?? ES.h50;
    const durIn = ivo + 180 + ivc, durEx = evo + 180 + evc;
    const icl = (ivc - ivo + 180) / 2;   // deg ATDC
    const ecl = (evo - evc + 180) / 2;   // deg BTDC
    // harmonic_cam_lobe (scripting/include/actions.h:437-463):
    //   lift(x) = L * (0.5 + 0.5 cos(k x))^gamma,  k = acos(s) / (D/4),
    //   s = (2 * 0.050in / L)^(1/gamma) - 1,  x in cam angle.
    // Choose its D so the generated lobe crosses the check lift h at our duration:
    //   D = D_target * acos(s) / acos(2 (h/L)^(1/gamma) - 1)
    const durationParam = (D, L) => {
        if (!(L > h)) throw new Error(`valve lift ${L} mm must exceed check lift ${h} mm`);
        const s = Math.pow(2 * ES.h50 / L, 1 / gamma) - 1;
        const c = 2 * Math.pow(h / L, 1 / gamma) - 1;
        if (!(s > -1 && s < 1)) throw new Error(`lift ${L} mm is outside harmonic_cam_lobe's range for gamma ${gamma}`);
        return D * Math.acos(s) / Math.acos(c);
    };
    if (!(durIn > 0 && durIn < 360 && durEx > 0 && durEx < 360)) throw new Error('cam durations must be between 0 and 360 crank deg');
    return {
        ivo, ivc, evo, evc, h, durIn, durEx, icl, ecl, lsa: (icl + ecl) / 2,
        durParamIn: durationParam(durIn, Lin), durParamEx: durationParam(durEx, Lex), Lin, Lex,
    };
}

function pickDonor(n, requested) {
    if (requested && requested !== 'auto') {
        if (!DONORS[requested]) throw new Error('unknown donor ' + requested);
        return requested;
    }
    if (n <= 2) return 'trx520';
    if (n <= 6) return 'ej25';
    return 'gm_ls';
}

// ---------------------------------------------------------------------------
// main export
// ---------------------------------------------------------------------------
function toEngineSimDetailed(spec, options = {}) {
    const opt = {
        target: 'ce', donor: 'auto', flowCoefficients: 'example', useLibraryParts: true, ...options,
    };
    if (!['ce', 'upstream', 'fork'].includes(opt.target)) throw new Error("options.target must be 'ce', 'upstream' or 'fork'");
    if (!['geometric', 'example'].includes(opt.flowCoefficients)) throw new Error("options.flowCoefficients must be 'geometric' or 'example'");

    const warnings = [];
    const g = normalize(spec);
    const donorKey = pickDonor(g.n, opt.donor);
    const D = DONORS[donorKey];
    const id = ident(spec.name);

    const bore = req(spec, 'bore_mm', 'bore_mm'), stroke = req(spec, 'stroke_mm', 'stroke_mm');
    const rod = req(spec, 'rod_mm', 'rod_mm'), cr = req(spec, 'cr', 'cr');
    if (!(cr > 1)) throw new Error('spec.cr must be > 1');
    const redline = req(spec, 'redline_rpm', 'redline_rpm');
    const idle = req(spec, 'idle_rpm', 'idle_rpm');
    const it = spec.intake || {}, ex = spec.exhaust || {};
    const runnerL = req(it, 'runnerL_mm', 'intake.runnerL_mm'), runnerD = req(it, 'runnerD_mm', 'intake.runnerD_mm');
    const plenumL = req(it, 'plenumL', 'intake.plenumL');
    const primD = req(ex, 'primaryD_mm', 'exhaust.primaryD_mm'), collD = req(ex, 'collectorD_mm', 'exhaust.collectorD_mm');
    const sysL = req(ex, 'systemL_mm', 'exhaust.systemL_mm'), tipD = req(ex, 'tipD_mm', 'exhaust.tipD_mm');
    let primL = ex.primaryL_mm;
    let primPer = null;
    if (Array.isArray(primL)) {
        if (primL.length !== g.n || primL.some((x) => !(Number.isFinite(x) && x >= 0))) throw new Error('exhaust.primaryL_mm array needs one length per cylinder');
        primPer = primL.slice();
        primL = Math.min(...primPer);
    } else if (!(Number.isFinite(primL) && primL >= 0)) {
        throw new Error('exhaust.primaryL_mm must be a number or an array');
    }
    const gamma = Number(D.cam.gamma[0]);
    const cam = camFromEvents(spec.cam || {}, gamma);

    let ir = ex.impulseResponse || D.exhaust.impulse_response[0];
    if (!IR_NAMES.includes(ir)) throw new Error('exhaust.impulseResponse must be one of ' + IR_NAMES.join(', '));
    const irSrc = ex.impulseResponse ? '[spec] exhaust.impulseResponse' : src(D, D.exhaust.impulse_response[1]);

    // exhaust system grouping
    let systems;   // array of arrays of cylinder numbers
    let dual = !!ex.dual;
    if (dual && g.n === 1) { warnings.push('exhaust.dual ignored: a single cylinder feeds one exhaust system'); dual = false; }
    // exhaust.grouping: 'bank' (default for a V: each bank its own system) or '180' (180-degree headers: alternate
    // cylinders in the firing order share a collector, so each system fires at even intervals)
    const grouping = ex.grouping || (g.layout === 'inline' ? '180' : 'bank');
    if (!dual) systems = [g.banks.flatMap((b) => b.cyls)];
    else if (grouping === '180') systems = [g.order.filter((_, i) => i % 2 === 0), g.order.filter((_, i) => i % 2 === 1)];
    else systems = g.banks.map((b) => b.cyls.slice());
    const systemOf = {};
    systems.forEach((s, i) => s.forEach((c) => { systemOf[c] = i; }));

    // flow coefficients
    const flow = {};
    if (opt.flowCoefficients === 'geometric') {
        const f = (d, field) => {
            const scfm = kCarbScfmForArea(circleArea_m2(d));
            return [`k_carb(${fmt(scfm, 6)})`, `[derived] ideal orifice (Cd = 1) of spec.${field} = ${fmt(d)} mm: k = A / sqrt(M_air), shown as its k_carb rating (gas_system.cpp:131-229, units.h:178)`];
        };
        flow.outlet = f(tipD, 'exhaust.tipD_mm');
        flow.primary = f(primD, 'exhaust.primaryD_mm');
        flow.runner = f(runnerD, 'intake.runnerD_mm');
    } else {
        flow.outlet = [D.exhaust.outlet_flow_rate[0], src(D, D.exhaust.outlet_flow_rate[1])];
        flow.primary = [D.exhaust.primary_flow_rate[0], src(D, D.exhaust.primary_flow_rate[1])];
        flow.runner = [D.intake.runner_flow_rate[0],
            typeof D.intake.runner_flow_rate[1] === 'number' ? src(D, D.intake.runner_flow_rate[1]) : '[default] ' + D.intake.runner_flow_rate[1]];
        warnings.push('flow coefficients: the runner, primary and outlet orifices use the donor engine\'s ratings, not the spec diameters (ideal orifices of the spec diameters over-read badly on the dyno)');
    }

    // library-part shortcuts (only when they match the spec exactly)
    const sbc = [1, 8, 4, 3, 6, 5, 7, 2];
    const useSbcLib = opt.useLibraryParts && g.n === 8 && g.layout === 'V' && g.numbering === 'alternate'
        && !spec.firingAngles_deg && g.order.every((c, i) => c === sbc[i]);
    const useSingleLib = opt.useLibraryParts && g.n === 1;

    const L = [];
    const push = (s = '') => L.push(s);

    // ---------------- header
    push(`// ${spec.name || id} - exported for Engine Simulator as a ROUGH LISTENING PREVIEW.`);
    push('// Engine Simulator is a reference/example model, not an accurate acoustic simulation:');
    push('// each exhaust system is one lumped volume, pipe length is a pure audio delay, and the');
    push('// final sound is shaped by a recorded impulse response. Do not use it to judge a design.');
    push('//');
    push(`// Generated by export_es.js for target: ${opt.target === 'ce'
        ? 'Engine Simulator Community Edition v0.1.14a (load with "Load Script")'
        : opt.target === 'fork'
            ? 'Arcindweld/engine-sim fork with the 1-D exhaust model (import from assets/main.mr); the exhaust geometry below switches the 1-D pipes on'
            : 'open-source engine-sim (ange-yaghi/engine-sim): import from assets/main.mr, which calls main()'}`);
    push('// Value tags: [spec] calculator input, [derived] formula on calculator inputs,');
    push(`// [donor] copied from the MIT-licensed engine-sim example ${D.file} (${D.what}),`);
    push('//         Copyright 2022 AngeTheGreat (Ange Yaghi), MIT License, github.com/ange-yaghi/engine-sim');
    push('// [default] engine-sim default from es/objects/objects.mr (parameter left out).');
    push('// Cam timing convention: IVO deg BTDC, IVC deg ABDC, EVO deg BBDC, EVC deg ATDC at');
    push(`// ${fmt(cam.h)} mm valve lift. Cycle angle 0 = cylinder 1 TDC (compression).`);
    if (warnings.length) warnings.forEach((w) => push('// NOTE: ' + w));
    push('// Not representable in engine-sim (ignored): ' + [
        'collector merge geometry/taper', 'X/H-pipe crossovers', 'mufflers/resonators/chambers (only the impulse response file)',
        'pipe diameter changes after the collector', 'tip/outlet length', 'idle speed target (idle_rpm only sets the dyno minimum)',
    ].join('; ') + '.');
    push();
    push('import "engine_sim.mr"');
    push();
    push('units units()');
    push('constants constants()');
    push('impulse_response_library ir_lib()');
    push();

    // ---------------- wires
    push('private node wires {');
    for (let c = 1; c <= g.n; ++c) push(`    output wire${c}: ignition_wire();`);
    push('}');
    push();

    // ---------------- donor fuel turbulence function
    if (D.turbulenceFn) {
        push(`// ${src(D, D.turbulenceFn.lines)}`);
        push('private node turbulence_to_flame_speed_ratio {');
        push('    alias output __out:');
        push('        function(5.0)');
        D.turbulenceFn.samples.forEach(([x, y], i) => push(`            .add_sample(${fmt(x)}, ${y})${i === D.turbulenceFn.samples.length - 1 ? ';' : ''}`));
        push('}');
        push();
    }

    // ---------------- head node (flow-table style donors)
    if (D.style === 'flowtable') {
        push(`private node ${id}_head {`);
        push('    input intake_camshaft;');
        push('    input exhaust_camshaft;');
        push('    input chamber_volume;');
        push('    input intake_runner_cross_section_area;');
        push('    input exhaust_runner_cross_section_area;');
        push(`    input intake_runner_volume: ${D.head.intake_runner_volume[0]}; // ${src(D, D.head.intake_runner_volume[1])} (port volume)`);
        push(`    input exhaust_runner_volume: ${D.head.exhaust_runner_volume[0]}; // ${src(D, D.head.exhaust_runner_volume[1])} (port volume)`);
        push('    input flip_display: false;');
        push('    alias output __out: head;');
        push();
        push(`    // port flow (cfm @ 28 inH2O vs valve lift in thou): ${src(D, D.head.intakeFlowLines)}`);
        push('    function intake_flow(50 * units.thou)');
        push('    intake_flow');
        D.head.intakeFlow.forEach(([l, f]) => push(`        .add_flow_sample(${l}, ${f})`));
        push();
        push(`    // ${src(D, D.head.exhaustFlowLines)}`);
        push('    function exhaust_flow(50 * units.thou)');
        push('    exhaust_flow');
        D.head.exhaustFlow.forEach(([l, f]) => push(`        .add_flow_sample(${l}, ${f})`));
        push();
        push('    generic_cylinder_head head(');
        push('        chamber_volume: chamber_volume,');
        push('        intake_runner_volume: intake_runner_volume,');
        push('        intake_runner_cross_section_area: intake_runner_cross_section_area,');
        push('        exhaust_runner_volume: exhaust_runner_volume,');
        push('        exhaust_runner_cross_section_area: exhaust_runner_cross_section_area,');
        push('        intake_port_flow: intake_flow,');
        push('        exhaust_port_flow: exhaust_flow,');
        push('        valvetrain: standard_valvetrain(');
        push('            intake_camshaft: intake_camshaft,');
        push('            exhaust_camshaft: exhaust_camshaft');
        push('        ),');
        push('        flip_display: flip_display');
        push('    )');
        push('}');
        push();
    }

    // ---------------- camshaft node (general case)
    if (!useSbcLib && !useSingleLib) {
        push(`private node ${id}_camshaft {`);
        push('    input intake_lobe_profile;');
        push('    input exhaust_lobe_profile;');
        push('    input intake_lobe_center;');
        push('    input exhaust_lobe_center;');
        push('    input advance: 0 * units.deg;  // timing is carried entirely by the lobe centerlines');
        push('    input base_radius;');
        push();
        g.banks.forEach((_, bi) => {
            push(`    output intake_cam_${bi}: _intake_cam_${bi};`);
            push(`    output exhaust_cam_${bi}: _exhaust_cam_${bi};`);
        });
        push();
        push('    camshaft_parameters params(advance: advance, base_radius: base_radius)');
        g.banks.forEach((_, bi) => {
            push(`    camshaft _intake_cam_${bi}(params, lobe_profile: intake_lobe_profile)`);
            push(`    camshaft _exhaust_cam_${bi}(params, lobe_profile: exhaust_lobe_profile)`);
        });
        push();
        push('    label rot360(360 * units.deg)');
        push('    // lobe peak at cycle angle = centerline + advance (camshaft.cpp:41-59, camshaft.h:39);');
        push('    // offsets = [derived] each cylinder\'s TDC-compression cycle angle from spec.firingOrder');
        g.banks.forEach((bk, bi) => {
            push(`    _exhaust_cam_${bi}`);
            bk.cyls.forEach((c) => push(`        .add_lobe(rot360 - exhaust_lobe_center + ${deg(g.phi[c])}) // cyl ${c}`));
            push(`    _intake_cam_${bi}`);
            bk.cyls.forEach((c) => push(`        .add_lobe(rot360 + intake_lobe_center + ${deg(g.phi[c])}) // cyl ${c}`));
        });
        push('}');
        push();
    }

    // ---------------- engine node
    const E = D.engine;
    push(`public node ${id} {`);
    push('    alias output __out: engine;');
    push();
    push('    engine engine(');
    push(`        name: ${mrString(spec.name || id)},  // [spec] name`);
    push(`        starter_torque: ${E.starter_torque[0]},  // ${src(D, E.starter_torque[1])}`);
    push(`        starter_speed: ${E.starter_speed[0]},  // ${src(D, E.starter_speed[1])}`);
    push(`        redline: ${fmt(redline)} * units.rpm,  // [spec] redline_rpm`);
    push(`        dyno_min_speed: ${fmt(idle)} * units.rpm,  // [spec] idle_rpm (engine-sim has no idle target; this is the dyno sweep start)`);
    if (E.throttle_gamma) push(`        throttle_gamma: ${E.throttle_gamma[0]},  // ${src(D, E.throttle_gamma[1])}`);
    push(`        fuel: ${E.fuel[0]},  // ${src(D, E.fuel[1])}`);
    push(`        hf_gain: ${E.hf_gain[0]},  // ${src(D, E.hf_gain[1])}`);
    push(`        noise: ${E.noise[0]},  // ${src(D, E.noise[1])}`);
    push(`        jitter: ${E.jitter[0]},  // ${src(D, E.jitter[1])}`);
    push(`        simulation_frequency: ${E.simulation_frequency[0]}  // ${src(D, E.simulation_frequency[1])}`);
    push('    )');
    push();
    push('    wires wires()');
    push();
    push(`    label bore(${mm(bore)})  // [spec] bore_mm`);
    push(`    label stroke(${mm(stroke)})  // [spec] stroke_mm`);
    push(`    label rod_length(${mm(rod)})  // [spec] rod_mm`);
    push(`    label compression_ratio(${fmt(cr)})  // [spec] cr`);
    push(`    label compression_height(${D.piston.compression_height[0]})  // ${src(D, D.piston.compression_height[1])}`);
    push('    // [derived] total clearance volume for spec.cr: swept / (cr - 1). With deck_height =');
    push('    // stroke/2 + rod + compression_height the TDC volume is exactly chamber_volume');
    push('    // (combustion_chamber.cpp:120-132).');
    push('    label chamber_volume((constants.pi / 4.0) * bore * bore * stroke / (compression_ratio - 1.0))');
    if (D.rod.mass) push(`    label rod_mass(${D.rod.mass[0]})  // ${src(D, D.rod.mass[1])}`);
    D.crank.labels.forEach(([n, e, l]) => push(`    label ${n}(${e})  // ${src(D, l)}`));
    push();
    push('    crankshaft c0(');
    push('        throw: stroke / 2,  // [derived] stroke / 2');
    push(`        flywheel_mass: ${D.crank.flywheel_mass[0]},  // ${src(D, D.crank.flywheel_mass[1])}`);
    push(`        mass: ${D.crank.mass[0]},  // ${src(D, D.crank.mass[1])}`);
    push(`        friction_torque: ${D.crank.friction_torque[0]},  // ${src(D, D.crank.friction_torque[1])}`);
    push(`        moment_of_inertia: ${D.crank.moment_of_inertia[0]},  // ${src(D, D.crank.moment_of_inertia[1])}`);
    push('        position_x: 0.0,');
    push('        position_y: 0.0,');
    push(`        tdc: ${deg(g.tdc)}  // [derived] 90 deg + bank A angle (cylinder 1 at TDC at cycle angle 0)`);
    push('    )');
    push();
    push('    // [derived] journal angle = TDC cycle angle + (bank angle - bank A angle), mod 360');
    g.journals.forEach((j, i) => push(`    rod_journal rj${i}(angle: ${deg(j.angle)})  // cyl ${j.cyls.join(' & ')}`));
    push('    c0');
    g.journals.forEach((_, i) => push(`        .add_rod_journal(rj${i})`));
    push();
    push('    piston_parameters piston_params(');
    push(`        mass: ${D.piston.mass[0]},  // ${src(D, D.piston.mass[1])}`);
    push('        compression_height: compression_height,');
    push('        wrist_pin_position: 0.0,');
    push('        displacement: 0.0');
    push('    )');
    push();
    push('    connecting_rod_parameters cr_params(');
    push(`        mass: ${D.rod.mass ? 'rod_mass' : ''},`);
    push(`        moment_of_inertia: ${D.rod.moment_of_inertia[0]},  // ${src(D, D.rod.moment_of_inertia[1])}`);
    push('        center_of_mass: 0.0,');
    push('        length: rod_length');
    push('    )');
    push();
    const I = D.intake;
    push('    intake intake(');
    push(`        plenum_volume: ${fmt(plenumL)} * units.L,  // [spec] intake.plenumL`);
    push(`        plenum_cross_section_area: ${I.plenum_cross_section_area[0]},  // ${src(D, I.plenum_cross_section_area[1])}`);
    push(`        intake_flow_rate: ${I.intake_flow_rate[0]},  // ${src(D, I.intake_flow_rate[1])} (throttle/carb rating)`);
    push(`        runner_flow_rate: ${flow.runner[0]},  // ${flow.runner[1]}`);
    push(`        runner_length: ${mm(runnerL)},  // [spec] intake.runnerL_mm`);
    push(`        idle_flow_rate: ${I.idle_flow_rate[0]},  // ${src(D, I.idle_flow_rate[1])}`);
    push(`        idle_throttle_plate_position: ${I.idle_throttle_plate_position[0]},  // ${src(D, I.idle_throttle_plate_position[1])}`);
    push(`        velocity_decay: ${I.velocity_decay[0]}  // ${src(D, I.velocity_decay[1])}`);
    push('    )');
    push();
    const X = D.exhaust;
    push('    exhaust_system_parameters es_params(');
    push(`        collector_cross_section_area: circle_area(${mm(collD / 2)}),  // [spec] exhaust.collectorD_mm / 2 (circle_area takes a radius)`);
    push(`        outlet_flow_rate: ${flow.outlet[0]},  // ${flow.outlet[1]}`);
    push(`        primary_tube_length: ${mm(primL)},  // [spec] exhaust.primaryL_mm${primPer ? ' (shortest primary; per-cylinder extra below)' : ''}`);
    push(`        primary_flow_rate: ${flow.primary[0]},  // ${flow.primary[1]}`);
    push(`        velocity_decay: ${X.velocity_decay[0]}  // ${src(D, X.velocity_decay[1])}`);
    push('    )');
    push();
    systems.forEach((cyls, i) => {
        push(`    exhaust_system exhaust${i}(  // cylinders ${cyls.join(', ')}`);
        push('        es_params,');
        push(`        length: ${mm(sysL)},  // [spec] exhaust.systemL_mm (collector to tip)`);
        if (opt.target === 'fork') {
            // 1-D exhaust network (docs/exhaust-1d.md in the fork): setting any of these picks the 1-D model under exhaust_model: "auto"
            const E = spec.exhaust;
            push(`        primary_diameter: ${mm(E.primaryD_mm)},  // [spec] exhaust.primaryD_mm (1-D pipe)`);
            push(`        collector_diameter: ${mm(collD)},  // [spec] exhaust.collectorD_mm (1-D pipe)`);
            if (E.collectorL_mm > 0) push(`        collector_length: ${mm(E.collectorL_mm)},  // [spec] merge cone + collector straight`);
            if (E.megaphoneL_mm > 0 && E.megaphoneExitD_mm > 0) {
                push(`        megaphone_length: ${mm(E.megaphoneL_mm)},  // [spec] megaphone after the collector`);
                push(`        megaphone_exit_diameter: ${mm(E.megaphoneExitD_mm)},  // [spec] megaphone exit`);
            }
            if (E.tailpipeL_mm > 0) {
                push(`        tailpipe_length: ${mm(E.tailpipeL_mm)},  // [spec] pipe after the cone to the tip`);
                if (E.tailpipeD_mm > 0) push(`        tailpipe_diameter: ${mm(E.tailpipeD_mm)},  // [spec] tailpipe diameter`);
            }
            push(`        pipe_cell_size: ${E.cellSize_mm > 0 ? mm(E.cellSize_mm) : '4.0 * units.cm'},  // 4 cm is the fork default; 2 cm for accuracy at a 5x time cost`);
        }
        push(`        audio_volume: ${X.audio_volume[0]},  // ${src(D, X.audio_volume[1])}`);
        push(`        impulse_response: ir_lib.${ir}  // ${irSrc}`);
        push('    )');
    });
    push();
    push('    cylinder_bank_parameters bank_params(');
    push('        bore: bore,');
    push('        deck_height: stroke / 2 + rod_length + compression_height  // [derived] same formula as all shipped engines');
    push('    )');
    push();
    g.banks.forEach((bk, bi) => push(`    cylinder_bank b${bi}(bank_params, angle: ${deg(bk.angle)})  // [derived] ${g.layout === 'inline' ? 'inline' : 'bank angle ' + fmt(g.bankAngle) + ' deg'}`));
    g.banks.forEach((bk, bi) => {
        push(`    b${bi}`);
        bk.cyls.forEach((c) => {
            push(`        .add_cylinder(  // cylinder ${c}`);
            push(`            piston: piston(piston_params, blowby: ${D.piston.blowby[0]}),  // blowby ${src(D, D.piston.blowby[1])}`);
            push('            connecting_rod: connecting_rod(cr_params),');
            push(`            rod_journal: rj${g.journalOf[c]},`);
            push('            intake: intake,');
            push(`            exhaust_system: exhaust${systemOf[c]},`);
            if (primPer) push(`            primary_length: ${mm(primPer[c - 1] - primL)},  // [derived] spec.exhaust.primaryL_mm[${c - 1}] - shortest`);
            push(`            ignition_wire: wires.wire${c}`);
            push('        )');
        });
        const camRef = useSbcLib ? `camshaft.${bi === 0 ? 'intake_cam_0' : 'intake_cam_1'}` : `camshaft.intake_cam_${bi}`;
        const camRefEx = useSbcLib ? `camshaft.${bi === 0 ? 'exhaust_cam_0' : 'exhaust_cam_1'}` : `camshaft.exhaust_cam_${bi}`;
        push('        .set_cylinder_head(');
        if (D.style === 'flowtable') {
            push(`            ${id}_head(`);
            push('                chamber_volume: chamber_volume,');
            push(`                intake_runner_cross_section_area: circle_area(${mm(runnerD / 2)}),  // [spec] intake.runnerD_mm / 2`);
            push(`                exhaust_runner_cross_section_area: circle_area(${mm(primD / 2)}),  // [spec] exhaust.primaryD_mm / 2 (port + primary share this area, combustion_chamber.cpp:94-109)`);
            push(`                intake_camshaft: ${camRef},`);
            push(`                exhaust_camshaft: ${camRefEx},`);
            push(`                flip_display: ${bi === 1 ? 'true' : 'false'})`);
        } else {
            push('            generic_small_engine_head(  // es/part-library/parts/heads.mr (port volumes: its 100 cc defaults)');
            push('                chamber_volume: chamber_volume,');
            push(`                intake_runner_cross_section_area: circle_area(${mm(runnerD / 2)}),  // [spec] intake.runnerD_mm / 2`);
            push(`                exhaust_runner_cross_section_area: circle_area(${mm(primD / 2)}),  // [spec] exhaust.primaryD_mm / 2`);
            push(`                flow_attenuation: ${D.head.flow_attenuation[0]},  // ${src(D, D.head.flow_attenuation[1])}`);
            push(`                intake_camshaft: ${camRef},`);
            push(`                exhaust_camshaft: ${camRefEx},`);
            push(`                flip_display: ${bi === 1 ? 'true' : 'false'})`);
        }
        push('        )');
    });
    push();
    push('    engine');
    g.banks.forEach((_, bi) => push(`        .add_cylinder_bank(b${bi})`));
    push();
    push('    engine.add_crankshaft(c0)');
    push();
    push(`    // [derived] spec.cam: intake ${fmt(cam.durIn)} deg / exhaust ${fmt(cam.durEx)} deg at ${fmt(cam.h)} mm,`);
    push(`    // ICL ${fmt(cam.icl)} ATDC, ECL ${fmt(cam.ecl)} BTDC, LSA ${fmt(cam.lsa)}. duration_at_50_thou is solved from`);
    push('    // harmonic_cam_lobe\'s own formula (actions.h:437-463) so the generated lobe crosses the');
    push('    // check lift exactly at the spec events.');
    push('    harmonic_cam_lobe intake_lobe(');
    push(`        duration_at_50_thou: ${deg(cam.durParamIn)},  // [derived] from spec.cam.ivo/ivc`);
    push(`        gamma: ${D.cam.gamma[0]},  // ${src(D, D.cam.gamma[1])}`);
    push(`        lift: ${mm(cam.Lin)},  // [spec] cam.liftIn_mm`);
    push(`        steps: ${D.cam.steps[0]}  // ${src(D, D.cam.steps[1])}`);
    push('    )');
    push('    harmonic_cam_lobe exhaust_lobe(');
    push(`        duration_at_50_thou: ${deg(cam.durParamEx)},  // [derived] from spec.cam.evo/evc`);
    push(`        gamma: ${D.cam.gamma[0]},  // ${src(D, D.cam.gamma[1])}`);
    push(`        lift: ${mm(cam.Lex)},  // [spec] cam.liftEx_mm`);
    push(`        steps: ${D.cam.steps[0]}  // ${src(D, D.cam.steps[1])}`);
    push('    )');
    push();
    if (useSbcLib) {
        push('    // es/part-library/parts/camshafts.mr chevy_bbc_camshaft_builder: its lobe order is the');
        push('    // 1-8-4-3-6-5-7-2 firing order with odd cylinders on bank A, matching this spec.');
        push('    chevy_bbc_camshaft_builder camshaft(');
    } else if (useSingleLib) {
        push('    // es/part-library/parts/camshafts.mr vtwin90_camshaft_builder (cam_0 only), as the donor does');
        push('    vtwin90_camshaft_builder camshaft(');
        push('        lobe_profile: intake_lobe,');
    } else {
        push(`    ${id}_camshaft camshaft(`);
    }
    push('        intake_lobe_profile: intake_lobe,');
    push('        exhaust_lobe_profile: exhaust_lobe,');
    push(`        intake_lobe_center: ${deg(cam.icl)},  // [derived] (IVC - IVO + 180) / 2`);
    push(`        exhaust_lobe_center: ${deg(cam.ecl)},  // [derived] (EVO - EVC + 180) / 2`);
    push('        advance: 0 * units.deg,');
    push(`        base_radius: ${D.cam.base_radius[0]}  // ${src(D, D.cam.base_radius[1])} (display only)`);
    push('    )');
    push();
    push(`    function timing_curve(1000 * units.rpm)  // ${src(D, D.ignition.timingLines)}`);
    push('    timing_curve');
    D.ignition.timing.forEach(([r, a]) => push(`        .add_sample(${r} * units.rpm, ${a} * units.deg)`));
    push();
    if (useSbcLib || useSingleLib) {
        const lib = useSbcLib ? 'chevy_sbc_distributor' : 'single_cylinder_distributor';
        push(`    // es/part-library/parts/ignition_modules.mr ${lib}; limiter_duration = objects.mr default`);
        push(`    engine.add_ignition_module(`);
        push(`        ${lib}(`);
        push('            wires: wires,');
        push('            timing_curve: timing_curve,');
        push(`            rev_limit: ${fmt(redline)} * units.rpm  // [spec] redline_rpm`);
        push('        ))');
    } else {
        push('    ignition_module ignition_module(');
        push('        timing_curve: timing_curve,');
        push(`        rev_limit: ${fmt(redline)} * units.rpm${D.ignition.limiter_duration ? ',' : ''}  // [spec] redline_rpm`);
        if (D.ignition.limiter_duration) push(`        limiter_duration: ${D.ignition.limiter_duration[0]})  // ${src(D, D.ignition.limiter_duration[1])}`);
        else push('    )');
        push('    // [derived] spark at each cylinder\'s TDC-compression cycle angle (ignition_module.cpp:53-98)');
        push('    ignition_module');
        g.order.forEach((c) => push(`        .connect_wire(wires.wire${c}, ${deg(g.phi[c])})`));
        push();
        push('    engine.add_ignition_module(ignition_module)');
    }
    push('}');
    push();

    // ---------------- vehicle / transmission (needed to run; donor values)
    push(`// ${src(D, D.vehicle.lines)}`);
    push(`private node ${id}_vehicle {`);
    push('    alias output __out:');
    push('        vehicle(');
    D.vehicle.params.forEach((p, i) => push(`            ${p}${i < D.vehicle.params.length - 1 ? ',' : ''}`));
    push('        );');
    push('}');
    push();
    push(`// ${src(D, D.transmission.lines)}`);
    push(`private node ${id}_transmission {`);
    push('    alias output __out:');
    push(`        transmission(max_clutch_torque: ${D.transmission.max_clutch_torque})`);
    D.transmission.gears.forEach((r, i) => push(`        .add_gear(${fmt(r)})${i === D.transmission.gears.length - 1 ? ';' : ''}`));
    push('}');
    push();
    push('// set_engine/set_transmission/set_vehicle exist in both CE and upstream; CE\'s run()');
    push('// (es/actions/actions.mr) is defined as exactly these three calls.');
    push('public node main {');
    push(`    set_engine(${id}())`);
    push(`    set_transmission(${id}_transmission())`);
    push(`    set_vehicle(${id}_vehicle())`);
    push('}');
    if (opt.target === 'ce') {
        push();
        push('main()');
    }
    push();

    return {
        text: L.join('\n'),
        warnings,
        donor: donorKey,
        derived: {
            identifier: id,
            tdc_deg: g.tdc,
            banks: g.banks.map((b) => ({ angle_deg: b.angle, cylinders: b.cyls })),
            journals: g.journals,
            tdcCycleAngle_deg: g.phi,
            exhaustSystems: systems,
            cam,
            chamberVolume_cc: (Math.PI / 4) * Math.pow(bore / 10, 2) * (stroke / 10) / (cr - 1),
            flow: { outlet: flow.outlet[0], primary: flow.primary[0], runner: flow.runner[0] },
            usedLibrary: useSbcLib ? 'chevy_bbc_camshaft_builder + chevy_sbc_distributor'
                : useSingleLib ? 'vtwin90_camshaft_builder + single_cylinder_distributor' : null,
        },
    };
}

/** Returns the complete .mr file text. */
function toEngineSim(spec, options) {
    return toEngineSimDetailed(spec, options).text;
}

module.exports = { toEngineSim, toEngineSimDetailed, kCarb, kCarbScfmForArea, DONORS, IR_NAMES, ES };
