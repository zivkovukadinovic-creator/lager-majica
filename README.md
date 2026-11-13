# Lager majica — paket za pregled produkcijske zamjene

**Draft, bez objave. Nijedan Supabase projekat nije kontaktiran tokom provjera.**

Paket sadrži gotov `index.html` zasnovan na cijelom testnom programu, R BIRO logo, minimalnu SQL migraciju, lokalne testove i njihove rezultate. Produkcijski `main`, podaci, Auth nalozi i objava nisu izmijenjeni.

## Šta je potrebno

Za punu standardizaciju upisa potrebna je **minimalna kanonska migracija**. Čitanje, filteri i Excel koriste postojeće kolone; problem je konkretan XXL/2XL ključ kod upisa. Detalji i odgodiva poboljšanja su u [docs/ODLUKA.md](docs/ODLUKA.md).

## Jedan paket

- `index.html`, `R BIRO logo.svg`: pripremljena nova produkcijska verzija s produkcijskim javnim URL-om/ključem.
- `sql/02_minimal_migration.sql`: jedina migracija potrebna za ovu isporuku; početna zaštita aktivna, kraj ROLLBACK.
- `sql/01_readonly_checks.sql`, `sql/03_verify.sql`: SELECT provjere prije/poslije.
- `tests/`: aplikacijski testovi, lokalni PostgreSQL 17.11 i browser testovi.
- `reports/`: rezultati izvršenih lokalnih provjera i izvori.
- `docs/PUSTANJE.md`: preostali ručni koraci, kriteriji uspjeha i povratak.

Ne uključuje produkcijske Auth naloge, pristupne podatke, kompletan produkcijski izvoz ili automatski deployment. Podaci testova su jasno označene sintetičke fixture vrijednosti. Postojeća testna baza se ne prepisuje.

## Izvršene provjere

**48/48 PASS:** 14 aplikacijskih, 24 PostgreSQL i 10 browser provjera. Lokalni server: PostgreSQL 17.11, UTF8, en_US.UTF-8; browser: Chromium 156. Stvarni XLSX je otvoren i provjeren. Detalji su u `reports/summary.json` i `reports/all-tests.txt`.

## Lokalna provjera i pregled

Linux x64, Node >=20, dostupan Chromium. Koristi se isključivo novi privremeni PostgreSQL klaster na Unix socketu, bez TCP slušanja. Nije prihvaćen DATABASE_URL niti drugi parametar udaljene baze.

```sh
npm ci --ignore-scripts
npm test
npm run preview
```

Native bibliotečke symlinkove paket PostgreSQL-a obnavlja lokalni runner, bez preuzimanja tokom testa. Ako Chromium nije na `/usr/bin/chromium`, podesiti `CHROMIUM_EXECUTABLE` na lokalni browser ili instalirati Playwright Chromium iz dozvoljenog izvora. Browser runner u ovoj sesiji uspješno je koristio sistemski Chromium.

`npm run preview` prikazuje samo sintetički lager: lokalni Supabase test double, stvarni ExcelJS i CSP `connect-src 'none'`. **Ne otvarati root index.html direktno radi testiranja**: on je produkcijski kandidat i sadrži stvarni javni produkcijski endpoint.

PostgreSQL testovi koriste prave SQL funkcije/RLS/indekse sa stubom `auth.uid()` i lažnim UUID-jevima. Browser koristi offline Auth test double. Stvarni Supabase GoTrue/JWT/PostgREST/CDN i postojeći korisnički nalozi nisu testirani uživo. To se provjerava kratkim ručnim smoke testom nakon odobrene isporuke.
