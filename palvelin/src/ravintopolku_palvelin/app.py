"""Ravintopolun palvelin: sovelluksen tiedostot ja synkronointirajapinta (aiops ADR-0016).

Palvelin kuuntelee vain Unix-soketissa, johon Tailscale Serve ohjaa portin 8443. Tunnistus kuten Ilmari Hubissa: osoite
(X-Forwarded-Host tai Host), Tailscale-tunnus sallittujen listalla, Funnel hylätään ja otsakkeiden toistot hylätään.
POST ja DELETE hyväksytään vain omasta alkuperästä. Rajapinnassa ei ole verkkoa eikä salaisuuksia. Ilmarin
aterialuonnokset luetaan pudotushakemistosta (aiops ADR-0026) ja tarjoillaan laatikkoon /api/luonnokset. Kuvasta
ateria (/api/kuva-ateria) kutsuu aiops-välittäjää Unix-soketissa (aiops ADR-0025/-0027); ilman konfiguroitua
sokettia reitti vastaa 404.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import kanta, kuva, luonnokset
from .config import PORTTI, Asetukset

PYYNTO_MAX = 1024 * 1024
KUVAPYYNTO_MAX = kuva.KUVA_MAX + 64 * 1024  # kuva ja lomakekentät multipart-kuorineen
KUVAKUTSUJA_MAX = 2  # samanaikaisia välittäjäkutsuja
VIENTI_VALI_S = 60.0  # julkinen kopio enintään kerran minuutissa
HUOLTO_VALI_S = 60.0  # huoltosilmukka: varmistus ja viivästynyt vienti
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; "
       "connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'")
loki = logging.getLogger("ravintopolku")


def _arvot(otsakkeet: list, nimi: bytes) -> list[bytes]:
    return [arvo for avain, arvo in otsakkeet if avain.lower() == nimi]


def hylkays(request: Request, a: Asetukset) -> tuple[int, str] | None:
    o = request.scope.get("headers", [])
    if request.scope.get("client") is not None:
        return 403, "vain Unix-soketti"
    if request.method not in ("GET", "HEAD", "POST", "DELETE"):
        return 405, "metodi ei sallittu"
    xfh, host = _arvot(o, b"x-forwarded-host"), _arvot(o, b"host")
    if len(xfh) > 1 or len(host) > 1:
        return 421, "osoite ei ole yksikäsitteinen"
    nimi = (xfh or host or [b""])[0].decode("latin-1").lower()
    if nimi not in (a.rp_id, f"{a.rp_id}:{PORTTI}"):
        return 421, "väärä osoite"
    if _arvot(o, b"tailscale-funnel-request"):
        return 403, "Funnel-pyyntöjä ei palvella"
    tunnus = _arvot(o, b"tailscale-user-login")
    if len(tunnus) != 1 or tunnus[0].decode("latin-1") not in a.kayttajat:
        return 403, "Tailscale-tunnus puuttuu tai sitä ei ole sallittu"
    sivusto = _arvot(o, b"sec-fetch-site")
    if len(sivusto) > 1:
        return 403, "Sec-Fetch-Site ei ole yksikäsitteinen"
    if request.url.path.startswith("/api/") and sivusto and sivusto[0] not in (b"same-origin", b"none"):
        return 403, "rajapinta vain omasta alkuperästä"
    if request.method in ("POST", "DELETE"):
        alkupera = _arvot(o, b"origin")
        if len(alkupera) != 1 or alkupera[0] != a.alkupera.encode("ascii"):
            return 403, f"{request.method} vain omasta alkuperästä"
        if sivusto and sivusto[0] != b"same-origin":
            return 403, f"{request.method} vain omasta alkuperästä"
    return None


def luo(a: Asetukset) -> Starlette:
    yhteys = kanta.avaa(a.tietokanta)
    lukko = asyncio.Lock()
    kuvalukko = asyncio.Semaphore(KUVAKUTSUJA_MAX)
    tila = {"likainen": True, "viety": 0.0}

    async def kirjoita_vienti() -> None:
        await run_in_threadpool(kanta.vie, yhteys, a.julkinen)
        tila["likainen"], tila["viety"] = False, time.monotonic()

    async def nouda_luonnokset() -> None:
        """Kutsujalla on lukko. Pudotushakemisto luetaan vain, jos se on konfiguroitu; vanhentaminen tehdään aina."""
        await run_in_threadpool(kanta.luonnokset_vanhenna, yhteys)
        if a.luonnokset is not None:
            await run_in_threadpool(luonnokset.nouda, yhteys, a.luonnokset)

    async def huolto() -> None:
        async with lukko:
            await run_in_threadpool(kanta.varmista, yhteys, a.varmistus)
            if tila["likainen"]:
                await kirjoita_vienti()
            await nouda_luonnokset()

    async def silmukka() -> None:
        while True:
            try:
                await huolto()
            except Exception:  # huolto ei saa kaataa palvelinta; virhe näkyy lokissa
                loki.exception("huolto epäonnistui")
            await asyncio.sleep(HUOLTO_VALI_S)

    @contextlib.asynccontextmanager
    async def elinkaari(_app):
        tehtava = asyncio.create_task(silmukka())
        try:
            yield
        finally:
            tehtava.cancel()
            yhteys.close()

    def kayttaja(request: Request) -> str:
        return a.kayttajat[request.headers["tailscale-user-login"]]

    async def api_tila(request: Request) -> Response:
        async with lukko:
            t = await run_in_threadpool(kanta.tilasto, yhteys)
        return JSONResponse({**t, "kayttaja": kayttaja(request)})

    async def api_hae(request: Request) -> Response:
        try:
            jalkeen = int(request.query_params.get("jalkeen", "0"))
        except ValueError:
            return JSONResponse({"virhe": "jalkeen: kokonaisluku"}, status_code=400)
        try:
            async with lukko:
                muutokset, lisaa = await run_in_threadpool(kanta.hae, yhteys, jalkeen)
                seq = await run_in_threadpool(kanta.suurin_seq, yhteys)
        except kanta.Hylatty as e:
            return JSONResponse({"virhe": str(e)}, status_code=400)
        return JSONResponse({"muutokset": muutokset, "lisaa": lisaa, "seq": seq})

    async def api_synk(request: Request) -> Response:
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            return JSONResponse({"virhe": "Content-Type: application/json"}, status_code=415)
        runko = b""
        async for pala in request.stream():
            runko += pala
            if len(runko) > PYYNTO_MAX:
                return JSONResponse({"virhe": "pyyntö on yli 1 MiB"}, status_code=413)
        try:
            data = json.loads(runko)
        except ValueError:
            return JSONResponse({"virhe": "runko ei ole JSONia"}, status_code=400)
        if not isinstance(data, dict) or set(data) - {"jalkeen", "muutokset"}:
            return JSONResponse({"virhe": "runko: olio, jossa jalkeen ja muutokset"}, status_code=400)
        laite = f"{kayttaja(request)}@{request.headers.get('x-forwarded-for', '?')[:64]}"
        try:
            async with lukko:
                kuitatut = await run_in_threadpool(kanta.sovella, yhteys, data.get("muutokset", []), laite)
                muutokset, lisaa = await run_in_threadpool(kanta.hae, yhteys, data.get("jalkeen", 0))
                seq = await run_in_threadpool(kanta.suurin_seq, yhteys)
                if kuitatut:
                    tila["likainen"] = True
                    if time.monotonic() - tila["viety"] >= VIENTI_VALI_S:  # muuten huoltosilmukka vie myöhemmin
                        await kirjoita_vienti()
        except kanta.Hylatty as e:
            return JSONResponse({"virhe": str(e)}, status_code=400)
        return JSONResponse({"kuitatut": kuitatut, "muutokset": muutokset, "lisaa": lisaa, "seq": seq})

    async def api_luonnokset(request: Request) -> Response:
        async with lukko:
            await nouda_luonnokset()
            odottavat = await run_in_threadpool(kanta.luonnokset_odottavat, yhteys)
        return JSONResponse({"luonnokset": odottavat})

    async def api_luonnos_valmis(request: Request) -> Response:
        async with lukko:
            loytyi = await run_in_threadpool(kanta.luonnos_valmis, yhteys, request.path_params["id"])
        if not loytyi:
            return JSONResponse({"virhe": "luonnosta ei ole odottamassa"}, status_code=404)
        return JSONResponse({"ok": True})

    async def api_kuva_ateria(request: Request) -> Response:
        """Kuvasta ateria (aiops ADR-0027). Ei pidä synkronointilukkoa: välittäjäkutsu voi kestää minuutin."""
        if a.valittaja is None:
            return JSONResponse({"virhe": "kuvasta ateria ei ole käytössä tällä palvelimella"}, status_code=404)
        runko = b""
        async for pala in request.stream():
            runko += pala
            if len(runko) > KUVAPYYNTO_MAX:
                return JSONResponse({"virhe": "kuva on yli 8 MiB"}, status_code=413)
        try:
            kentat = kuva.jasenna_multipart(request.headers.get("content-type", ""), runko)
            data, mime, rooli, pvm, vihje = kuva.tarkista_pyynto(kentat)
            async with kuvalukko:
                tulos = await run_in_threadpool(kuva.tulkitse, str(a.valittaja), data, mime, rooli, vihje)
        except kuva.Virhe as e:
            return JSONResponse({"virhe": str(e)}, status_code=e.tila)
        return JSONResponse({**tulos, "pvm": pvm})

    async def api_tuntematon(request: Request) -> Response:
        return JSONResponse({"virhe": "ei rajapintaa"}, status_code=404)

    async def vartija(request: Request, call_next):
        syy = hylkays(request, a)
        vastaus = (JSONResponse({"virhe": syy[1]}, status_code=syy[0]) if syy else await call_next(request))
        polku = request.url.path
        vastaus.headers.update({"Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
                                "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"})
        if polku.startswith("/api/") or syy:
            vastaus.headers["Cache-Control"] = "no-store"
        elif polku in ("/", "/index.html", "/sw.js", "/manifest.webmanifest"):
            vastaus.headers["Cache-Control"] = "no-cache"
        return vastaus

    sovellus = Starlette(routes=[
        Route("/api/tila", api_tila, methods=["GET"]),
        Route("/api/synk", api_hae, methods=["GET"]),
        Route("/api/synk", api_synk, methods=["POST"]),
        Route("/api/luonnokset", api_luonnokset, methods=["GET"]),
        Route("/api/luonnokset/{id:int}", api_luonnos_valmis, methods=["DELETE"]),
        Route("/api/kuva-ateria", api_kuva_ateria, methods=["POST"]),
        Route("/api/{polku:path}", api_tuntematon, methods=["GET", "POST", "DELETE"]),
        Mount("/", app=StaticFiles(directory=str(a.sovellus), html=True, check_dir=False)),
    ], middleware=[Middleware(BaseHTTPMiddleware, dispatch=vartija)], lifespan=elinkaari)
    return sovellus
