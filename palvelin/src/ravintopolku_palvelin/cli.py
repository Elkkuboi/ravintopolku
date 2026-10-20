"""Käynnistin: vain Unix-soketti, hakemisto 0700 ja oma omistaja (kuten Ilmari Hub)."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import stat
import sys

import uvicorn

from .app import luo
from .config import OLETUS, Virhe, lue


def main() -> None:
    p = argparse.ArgumentParser(description="Ravintopolun palvelin (aiops ADR-0016).")
    p.add_argument("--config", type=Path, default=OLETUS)
    p.add_argument("--socket", type=Path, required=True)
    args = p.parse_args()
    try:
        asetukset = lue(args.config)
    except Virhe as e:
        p.error(str(e))
    hakemisto = args.socket.parent
    tiedot = os.stat(hakemisto, follow_symlinks=False)
    if not stat.S_ISDIR(tiedot.st_mode) or tiedot.st_uid != os.getuid() or stat.S_IMODE(tiedot.st_mode) != 0o700:
        p.error(f"soketin hakemiston {hakemisto} pitää olla oma ja tilassa 0700")
    os.umask(0o077)
    if args.socket.is_socket():
        args.socket.unlink()
    uvicorn.run(luo(asetukset), uds=str(args.socket), log_level="info", proxy_headers=False,
                server_header=False, date_header=False, access_log=False)
    sys.exit(0)
