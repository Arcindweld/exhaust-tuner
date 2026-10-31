# CAD reference parts

Rough solid models of bought parts, for laying out pipes around a scan (bore, spigot, flange and the space the
sensors take up). They are not drawings of the parts: each script tags every number with its source, and the
ones marked [est] are to be replaced with measurements (each script lists what to measure).

| Script | Part | Output |
|---|---|---|
| `parts/holley_112_583.py` | Holley EFI 112-583 billet 105 mm LS throttle body (straight bore, cable, 4-bolt) | `out/holley_112-583_105mm_rough.step/.stl` |
| `parts/kn_round_tapered.py` | K&N round tapered universal filter, from its catalogue dimensions | run with the part's numbers |

Build: CadQuery 2.x (`conda install -c conda-forge cadquery`), `python parts/<script>.py out`.
