# Najkraći preostali postupak

Ovaj dokument opisuje buduće ručno izvršavanje, ne predstavlja odobrenje. Ne treba novi cloud projekat niti novi krug prikupljanja već dostavljenih definicija.

1. **Pregledati Draft PR i offline preview.** Kriterij: prihvaćeni izgled i funkcije; svi lokalni testovi prolaze. Nova verzija i minimalni SQL moraju biti odobreni zajedno. Bez spajanja i objave u ovoj fazi.
2. **Prije odobrene promjene obezbijediti obnovljiv svjež backup i kratak prekid upisa.** Sačuvati strukturu/funkcije/grantove/RLS, podatke `majice` i `lager_urednici`, IDENTITY/sekvencu; backup ostaje privatan, izvan repozitorijuma. Potvrditi obnovljivost. Zaustaviti aplikacijske upise i paralelne administrativne promjene tokom provjere i potvrde. U dashboardu ručno potvrditi produkcijski ref `uoonawjzquwcqnwqdjbu`. Sam naziv baze `postgres` nije potvrda projekta.
3. **Ručno probati i zatim primijeniti samo `sql/02_minimal_migration.sql`, nakon izričitog odobrenja.** U pregledanoj izvršnoj kopiji omogućiti postojeću ručnu postavku `lager.migration_reviewed='yes'`; ne mijenjati ostale provjere. Prvi prolaz mora završiti postojećim ROLLBACK. Kriterij: nema greške, isti ID-jevi/količine/minimumi i promjena samo veličina ID-jeva30/42 na2XL. Ako nova normalizacija, podaci ili struktura odstupaju, STOP; ne popravljati podatke automatski i ne zaobilaziti provjeru. Tek poslije uspješne probe i odobrenja koristiti istu kopiju sa zamjenom samo posljednjeg ROLLBACK sa COMMIT; provjere se ponovo izvršavaju pod zaključavanjem. Pokrenuti `sql/03_verify.sql`. Kriterij: dva važeća jedinstvena indeksa, aktivan BEFORE INSERT/UPDATE trigger, kanonske funkcije, iste postojeće RPC definicije/grantovi i postojeći tipovi/NULL/default postavke.
4. **Tek nakon potvrđene baze odobriti merge i postojeću Pages objavu.** To obavlja korisnik/odgovorna osoba, ne ovaj paket. Poslije objave osvježiti browser i provjeriti prijavu postojećim nalogom urednika i pregledača, tri filtera+pretragu+reset, logo i otvaranje Excel datoteke. Urednik treba vidjeti editor, pregledač samo pregled. Provjeriti ukupne količine i minimume prema snimku poslije migracije. Prvi normalni radni unos urednika provjeriti po ID-u: povećava postojeću stavku, bez duplikata; ne praviti vještačke produkcijske promjene samo radi testa.

Za ovaj paket nema migracije podataka u drugu produkcijsku bazu, novih Auth naloga, izmjena korisničkih prava niti prepisivanja postojeće testne baze.

## Prije i poslije COMMIT-a

Prije potvrde: bilo koja SQL greška zahtijeva ROLLBACK u istoj sesiji; nema nastavka iza greške. Skripta ne poziva nextval/setval i ne mijenja sekvencu. Ne držati zaključavanje otvoreno radi dugog ručnog pregleda. Provjeriti sve rezultate, ne samo posljednju poruku SQL Editora.

Poslije potvrde: obični ROLLBACK više ne pomaže. Najjednostavniji aplikacijski povratak je vratiti prethodni `index.html` iz commita `2e5905146c7eab28d85d082e97287a759e605814` i objaviti ga nakon odobrenja. Minimalna baza ostaje kompatibilna sa starom verzijom: obe originalne RPC funkcije i originalni indeks su očuvani, trigger prihvata i XXL, podaci se ne moraju vraćati sa2XL naXXL.

Ako problem potiče iz baze: zaustaviti upise, sačuvati trenutno stanje i pregledati oporavak uz backup. Ne vraćati stare količine preko kasnijih stvarnih unosa, ne raditi automatski DROP CASCADE, spajanje redova ili reset sekvence. Eventualna povratna SQL migracija mora biti zasebno pregledana prema tadašnjem stanju.

## Šta još nije potvrđeno

- Nije ostvaren kontakt sa stvarnim Supabase Auth/PostgREST servisom ili produkcijskim nalozima. Lokalni SQL RLS je testiran, ali nije testiran stvarni JWT/session tok.
- Nije dostavljen svjež kompletan CSV lagera. To ne blokira ovu minimalnu migraciju: ona provjerava zatečene redove pod zaključavanjem i prekida pri odstupanju. Obnovljiv svjež produkcijski backup je uslov stvarne primjene.
- Nema odobrenja za produkcijsku migraciju, merge ili objavu. To je preostala odluka, a ne nedostatak već dostavljenih SQL definicija.
