# Odluka o zavisnostima i obimu

Nova aplikacija može čitati postojeću produkcijsku strukturu: obje tabele, sve kolone, Auth i potrebni postojeći RPC već postoje. Filteri, tekstualna pretraga, prikaz normalizovanih naziva, sortiranje i Excel računaju se u pregledniku.

**Kompletna nova verzija nije bezbjedna za upis bez kanonske zaštite baze.** Izvorni testni HTML `lager-majica-test-2.html` na commitu `46cb2cb32b6c4893b10ba408689dea75a68270ab`:

- `loadShirts`, izvorne linije 755–769: SELECT šest postojećih kolona i `map(normalizeShirt)` normalizuju prikaz, ne pohranjene redove.
- Linije 845–847: prije upisa `normalizeModel` i `normalizeSize` pretvaraju alias vrijednosti u kanonske.
- Linije 869–878: provjera postojećih stavki `sameShirt` blokira više podudaranja i konflikt uređivanja, ali kod jednog podudaranja ne mijenja RPC payload na izvorni ključ.
- Linije 897–904: `dodaj_majice_sa_minimumom` prima kanonsku veličinu. Produkcijski indeks razlikuje XXL i 2XL.
- Lokalni PostgreSQL 17.11 potvrđuje: početni ID 30 XXL/količina5 + novi payload 2XL/količina3 pravi drugi red. To nije samo teorijska pretpostavka.

Na početnoj strukturi nisu problem nedostajuće kolone ili RPC signatura, već neslaganje ključeva i paralelni/direktni upisi. Samo zamjena indeksa nije dovoljna: stari RPC koristi ON CONFLICT originalnog indeksa. Zato originalni indeks ostaje, a trigger dovodi sve upise na isti zapis prije ON CONFLICT provjere.

## Nužno za kompletnu verziju

- Preuzeti cijeli testni program i R BIRO logo.
- Zadržati produkcijski javni URL/ključ i postojeću tekstualnu pretragu, te kombinovati je sa tri filtera.
- Kanonske funkcije, BEFORE INSERT/UPDATE trigger i dodatni kanonski jedinstveni indeks.
- Pregledana normalizacija postojećih redova 30/42, uz ponavljanje provjera pod zaključavanjem; bez spajanja i bez promjene količina/minimuma.
- Sačuvati originalni indeks, obje RPC funkcije, vlasnike, postojeće grantove i RLS.

## Odgodivo

- smallint → integer za količinu. Postojeći raspon ostaje -32768..32767; RPC odbija prekoračenje bez djelimičnog upisa. Veći raspon nije uslov za standardizaciju.
- Nova NOT NULL/default i nenegativna CHECK ograničenja nad količinom, NOT NULL nad bojom/veličinom.
- Hardening postojećih širokih grantova, naročito TRUNCATE. Nisu preuzeti iz testa niti promijenjeni ovom isporukom.
- Izmjena tijela bilo kojeg postojećeg RPC-a ili prenos `rls_auto_enable`.
- Novi Supabase cloud projekat: lokalni runner već pravi izolovanu PostgreSQL 17.11 instancu za reprodukciju baze. Dodatni cloud projekat nije tehnički uslov za pripremu ove isporuke.

## Dodatne aplikacijske korekcije u paketu

- Uklonjen neaktivan signup put: aplikacija koristi samo prijavu postojećim nalogom, bez registracionih poruka.
- Popravljen nedostajući završni tag dugmeta za prijavu.
- Vraćena produkcijska tekstualna pretraga, uključujući pretragu XXL za prikaz 2XL; reset čisti i pretragu i tri filtera.
- Urednik prije omogućavanja upisa provjerava čistu funkciju `majice_canonical_size_v4('XXL')`. Ako nedostaje, aplikacija ostaje u režimu pregleda. To štiti od puštanja aplikacije prije poznate migracije; nije zamjena za provjeru indeksa i triggera.
- Normalizuju se samo grantovi TRI NOVE funkcije na vlasnika i PUBLIC EXECUTE; postojeći i globalni grantovi se ne diraju. Postojeća `dodaj_majice` ostaje ista, kao i nulta količina dozvoljena u produkcijskom RPC-u sa minimumom.

Raniji širi `nacrt_migracije.sql` nije skripta za ovu isporuku. Za ovaj paket koristi se samo `sql/02_minimal_migration.sql`. Ne primjenjivati obje migracije.
