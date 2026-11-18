# Supabase aktivnost — neaktivan prijedlog, 18.11.2026.

## Status i obuhvat

Pripremljeno za pregled. Fajl `.github/workflows/supabase-activity.yml.disabled`
ne prepoznaje se kao izvršiv GitHub workflow. Nema automatskog niti ručnog
pokretanja dok zadržava ovaj nastavak. Grana i ovaj dokument ne aktiviraju ništa.
Nema izmjena HTML programa, baze, funkcija ili RLS pravila.

Osnova: nacrt iz sigurnosnog paketa od 17.11. i paket od 18.11.2026.
Produkcijski commit pri pregledu: `7a230f4551f2b7bcf3f78b6ae99a2c968d502a50`,
isti kao `backup-prije-automatizacije-2026-11-17` prema prethodnom pregledu.
Integritet svih 16 fajlova novijeg paketa provjeren je SHA-256 sumama.
Paket sadrži izvoz baze i rekonstruisane SQL skripte; nema kompletnog Auth
backupa i obnova nije testirana. Naziv „završni paket“ ne znači testiranu obnovu.
Poslovni podaci i sadržaj tog paketa nisu dodati na GitHub.

## Provjera pristupa i zahtjeva

Izvoz baze od 18.11.2026. u 08:15:49 UTC pokazuje:

- `majice`: RLS uključen, `anon` ima tabelarnu SELECT dozvolu,
  ali nema odgovarajuću RLS politiku za SELECT. Pravo čitanja redova ima
  `authenticated`. Očekivani anon odgovor je zato prazna lista `[]`.
- `lager_urednici`: RLS uključen; ovaj workflow je uopšte ne poziva.
- Ne koriste se funkcije/RPC, korisničke sesije, lozinke ni povišene uloge.

To je pregled sačuvanog snimka, ne provjera žive baze. Prije aktivacije treba
potvrditi da su RLS i grantovi i dalje isti. Ako pristup ne radi, ne širiti
dozvole, ne isključivati RLS i ne zamjenjivati ključ sa `service_role`/secret.

Zahtjev je isključivo HTTPS GET na `/rest/v1/majice?select=id&limit=1`.
U odnosu na stari `limit=0`, `limit=1` traži ograničeni SELECT uz postojeći RLS;
ne traži količine, modele ili druge poslovne kolone. Po pregledanom RLS-u ne
vraća nijedan red. Ovo ipak ne dokazuje da će Supabase taj zahtjev računati kao
dovoljnu aktivnost: planer može primijeniti konstantno odbijanje RLS-a.
Ne obećava se izbjegavanje pauziranja.

Kod zahtijeva HTTP 200 i JSON `[]`. Ako se pojavi bilo kakav red, ne ispisuje
ga nego završava greškom. Ovo je dodatna kontrola, nije potpun test RLS-a:
prazna tabela takođe vraća `[]`. Čitanje je ograničeno na 1 ID i najviše 1025
bajtova odgovora. Nema ponavljanja zahtjeva, preusmjeravanja, POST, PUT,
PATCH, DELETE, SQL ili API poziva za upravljanje projektom. Rok je 25 sekundi,
a cijeli posao najviše 2 minute. URL je vezan SHA-256 otiskom za produkcijski
URL očitan iz trenutnog HTML-a, bez objave ključa.

`permissions: {}` uklanja dozvole GitHub tokena; nema checkout koraka,
spoljnih Actions zavisnosti, instalacije paketa ni prenosa artefakata.
Python koristi sistemsko provjeravanje TLS sertifikata.

## Pristupni podaci

Vlasnik ih unosi direktno na GitHub: Settings → Secrets and variables → Actions.
Ne slati vrijednosti kroz poruke, PR, commit, screenshot ili log.

| Vrsta | Naziv | Vrijednost / svrha |
|---|---|---|
| Repository secret | `SUPABASE_URL` | Produkcijski URL, bez završne kose crte i bez `/rest/v1` |
| Repository secret | `SUPABASE_ANON_KEY` | Preferirano postojeći `sb_publishable_…` ključ; podržan je i legacy anon JWT |
| Repository variable | `SUPABASE_ACTIVITY_ENABLED` | Ostaviti nepostavljeno ili `false` do odobrenja; `true` omogućava posao |

Naziv `SUPABASE_ANON_KEY` sačuvan je iz nacrta radi kontinuiteta, ali podržava
i publishable format. Publishable i anon su javni niskoprivilegovani ključevi,
nisu posebni read-only ključevi: stvarni pristup određuju grantovi i RLS.
Sama skripta koristi samo GET. Legacy JWT se lokalno provjerava na `role=anon`,
a autentičnost ključa provjerava Supabase. `sb_secret_…` i JWT sa drugim ulogama
se odbijaju prije mrežnog zahtjeva. Nikada koristiti service_role, secret key,
JWT signing secret, database password, access token ili podatke urednika.

Ključ se prosljeđuje samo kao `apikey` zaglavlje iz env, ne u URL-u ili
komandnim argumentima procesa. Nema ispisivanja zaglavlja, ključa, tijela
odgovora ili punih exception poruka. GitHub Secrets maskiranje je dodatna
zaštita. Osobe koje mogu mijenjati workflow imaju mogućnost upotrebe repository
secrets; ograničiti write pristup repozitorijumu. Secrets ne dodavati prije
pregleda konačnog koda. Ovom pripremom nisu čitana niti mijenjana GitHub Secrets
ili Actions podešavanja; njihov trenutni status nije potvrđen.

Supabase dokumentacija trenutno preporučuje publishable format i navodi
depreciranje legacy anon/service_role ključeva do kraja 2026. Nije mijenjan
postojeći ključ niti konfiguracija HTML aplikacije.

## Raspored i ograničenja provjerena 18.11.2026.

- Cron `23 7,15,23 * * *`: tri zahtjeva dnevno, u 07:23, 15:23 i 23:23 UTC.
  U BiH zimi: 08:23, 16:23 i 00:23 narednog dana; ljeti sat kasnije.
- Supabase može pauzirati Free projekte nakon sedmice slabe aktivnosti.
  Nekoliko dnevnih zahtjeva može pomoći; nema garantovanog praga za ovaj upit.
  Plaćeni projekti nisu predmet pauziranja zbog neaktivnosti. Plan, stanje i
  kvote ovog konkretnog projekta nisu dostupni iz backupa i čekaju provjeru.
  Ova automatizacija ne ukida kvote niti ponovo pokreće već pauziran projekat.
- GitHub schedule radi samo iz podrazumijevane grane. Posao dodatno zahtijeva
  `refs/heads/main` i tačan naziv repozitorijuma. Nema push/PR okidača.
- Raspored može kasniti ili preskočiti izvršavanje. U javnom repozitorijumu
  GitHub ga može isključiti nakon 60 dana bez aktivnosti repozitorijuma.
  Samo izvršavanje rasporeda ne treba smatrati resetovanjem tog roka.
- Provjeriti da su Actions dozvoljeni i da nalog/projekat nema ograničenja.
  Planirani obim je približno 90–93 kratka pokretanja mjesečno. Ne praviti
  vještačke commitove radi održavanja rasporeda; pratiti GitHub obavještenja.

## Provjere pripreme

YAML struktura i Python sintaksa su provjereni. Dvanaest izolovanih testova
sa simuliranom mrežom pokrilo je publishable/anon uspjeh, odbijanje service-role,
secret i nedostajućeg ključa, pogrešan projekat, neočekivane redove, neispravan
JSON, prevelik odgovor, HTTP preusmjeravanje, zabranu pristupa i mrežnu grešku.
Potvrđeni su GET metoda, fiksni endpoint, odsustvo korisničkog Authorization
tokena, najviše jedan poziv i neispisivanje testnih tajni/podataka.
Nije pokrenut workflow niti poslat probni zahtjev produkcijskom Supabaseu.

## Aktiviranje — samo poslije izričitog odobrenja

1. Pregledati ovaj PR i potvrditi aktuelni plan/stanje projekta, RLS/grantove
   i Actions podešavanja. Preporučeno je dovršiti test obnove u izolovanom
   projektu; sačuvani paket ga ne potvrđuje.
2. Nakon odobrenja promijeniti nastavak `.yml.disabled` u `.yml`, pregledati
   konačni diff i spojiti isključivo uz odobrenje vlasnika. Varijablu za sada
   ostaviti `false`, pa raspored još neće slati zahtjeve.
3. Direktno unijeti navedene Secrets i provjeriti da odgovaraju produkciji.
   Ne mijenjati bazu niti korisničke naloge radi ovog koraka.
4. Uz odobrenje za prvo izvršavanje postaviti varijablu na `true` i ručno
   pokrenuti workflow sa `main`. To istovremeno omogućava naredni raspored;
   ne uključivati dok nema saglasnosti za oba. Provjeriti samo status i poruku
   o praznom odgovoru, a u Supabase logovima/metrici potvrditi zahtjev.
5. Kod 401/403, pogrešnog URL-a, nepraznog odgovora ili drugih grešaka odmah
   isključiti varijablu i istražiti bez proširivanja dozvola. U slučaju pauze
   vlasnik ručno nastavlja projekat kroz Supabase Dashboard.
6. Pratiti prve zakazane pozive i obavještenja o pauziranju ili isključivanju
   rasporeda. Za hitno zaustavljanje postaviti varijablu `false` ili Disable
   workflow. Već pokrenut posao posebno otkazati ako je potrebno.

## Zvanični izvori

- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
