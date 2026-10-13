import os as _os

# 13.10.2026 — Tests: Ortsdienste aus der Netz-Konserve (nur wenn scripts/run_tests.py RZ_NETZ_KONSERVE setzt; nie in der App)
if _os.environ.get("RZ_NETZ_KONSERVE"):
    from . import netzkonserve as _nk
    _nk.aus_umgebung()
