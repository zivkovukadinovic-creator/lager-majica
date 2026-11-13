-- NACRT ZA PREGLED. PRODUKCIJSKO IZVRSAVANJE NIJE ODOBRENO.
-- Nema aktivnog COMMIT-a. Zavrsava sa ROLLBACK.
-- MINIMALNA MIGRACIJA: samo kanonske funkcije/indeks/trigger i pregledani nazivi.
-- Tipovi, NULL/default postavke i postojeci CHECK uslovi ostaju nepromijenjeni.
-- Nije idempotentan: vec migrirana baza mora biti odbijena.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
SET LOCAL row_security = off;

-- Ostaviti zakomentarisano.
-- Ovo je samo rucna zastita, NE provjera identiteta projekta.
-- SET LOCAL lager.migration_reviewed = 'yes';

DO $guard$
BEGIN
    IF current_setting('lager.migration_reviewed', true)
       IS DISTINCT FROM 'yes' THEN
        RAISE EXCEPTION
            'NACRT: izvrsavanje nije omoguceno niti odobreno.';
    END IF;

    IF current_user <> 'postgres' THEN
        RAISE EXCEPTION 'Ocekivana izvrsna uloga je postgres.';
    END IF;
END
$guard$;

-- Ceka zavrsetak ranijih transakcija nad ovim tabelama.
-- Zatim blokira njihove nove upise, citanja i promjene strukture
-- do kraja ove transakcije.
LOCK TABLE public.majice, public.lager_urednici
    IN ACCESS EXCLUSIVE MODE;

DO $preconditions$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = 'public.majice'::regclass
          AND attname = 'kolicina'
          AND atttypid = 'smallint'::regtype
          AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION
            'Neocekivan tip kolicina ili vec primijenjena migracija.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = 'public.majice'::regclass
          AND attname = 'id'
          AND atttypid = 'bigint'::regtype
          AND attnotnull
          AND attidentity = 'd'
          AND NOT attisdropped
    ) OR pg_get_serial_sequence('public.majice', 'id')
         IS DISTINCT FROM 'public.majice_id_seq' THEN
        RAISE EXCEPTION 'Neocekivana IDENTITY definicija.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE oid IN (
            'public.majice'::regclass,
            'public.lager_urednici'::regclass
        )
          AND (
              relkind <> 'r'
              OR relowner <> 'postgres'::regrole
              OR NOT relrowsecurity
              OR relforcerowsecurity
          )
    ) THEN
        RAISE EXCEPTION 'Neocekivan vlasnik, vrsta tabele ili RLS.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid IN (
            'public.majice'::regclass,
            'public.lager_urednici'::regclass
        )
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Pronadjen neocekivan postojeci trigger.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'majice_canonical_model_v4',
              'majice_canonical_size_v4',
              'majice_canonical_write_v4'
          )
    ) OR to_regclass('public.majice_canonical_unique_v4') IS NOT NULL THEN
        RAISE EXCEPTION 'Kanonski objekti vec postoje; potreban novi pregled.';
    END IF;

    IF to_regprocedure(
        'public.dodaj_majice(text,text,text,integer)'
    ) IS NULL OR to_regprocedure(
        'public.dodaj_majice_sa_minimumom(text,text,text,integer,integer)'
    ) IS NULL THEN
        RAISE EXCEPTION 'Nedostaje ocekivana RPC signatura.';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('dodaj_majice', 'dodaj_majice_sa_minimumom')
    ) <> 2 THEN
        RAISE EXCEPTION 'Neocekivani RPC overload-i.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid IN (
            'public.dodaj_majice(text,text,text,integer)'::regprocedure,
            'public.dodaj_majice_sa_minimumom(text,text,text,integer,integer)'
                ::regprocedure
        )
          AND (
              prosecdef
              OR prorettype <> 'void'::regtype
              OR proowner <> 'postgres'::regrole
          )
    ) THEN
        RAISE EXCEPTION 'Neocekivane RPC postavke.';
    END IF;

    -- Originalni ON CONFLICT indeks mora ostati dostupan RPC funkcijama.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_index
        WHERE indexrelid =
              to_regclass('public.majice_jedinstvena_stavka')
          AND indrelid = 'public.majice'::regclass
          AND indisunique AND indisvalid AND indisready
          AND pg_get_indexdef(indexrelid) =
              'CREATE UNIQUE INDEX majice_jedinstvena_stavka ON public.majice USING btree (lower(TRIM(BOTH FROM model)), lower(TRIM(BOTH FROM boja)), upper(TRIM(BOTH FROM velicina)))'
    ) THEN
        RAISE EXCEPTION 'Originalni jedinstveni indeks nije ocekivan.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.majice'::regclass
          AND conname = 'majice_kolicina_nenegativna_prod_v1'
    ) THEN
        RAISE EXCEPTION 'Predlozeno ogranicenje vec postoji.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.majice m
        WHERE id IS NULL
           OR model IS NULL OR model ~ '^[[:space:]]*$'
           OR boja IS NULL OR boja ~ '^[[:space:]]*$'
           OR velicina IS NULL OR velicina ~ '^[[:space:]]*$'
           OR kolicina IS NULL OR kolicina < 0
           OR minimalna_kolicina IS NULL OR minimalna_kolicina < 0
    ) THEN
        RAISE EXCEPTION 'Neispravni podaci; nema automatskih popravki.';
    END IF;
END
$preconditions$;

-- Zatecene vrijednosti; ne poziva se sekvenca.
CREATE TEMP TABLE _lm_rows_before ON COMMIT DROP AS
SELECT id, model, boja, velicina, kolicina, minimalna_kolicina
FROM public.majice;

-- Cijeli kataloski zapis postojecih RPC funkcija, ukljucujuci ACL.
CREATE TEMP TABLE _lm_structure_before ON COMMIT DROP AS
SELECT a.attnum, a.attname, a.atttypid, a.atttypmod,
       a.attnotnull, a.attidentity, a.attgenerated,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid='public.majice'::regclass
  AND a.attnum>0 AND NOT a.attisdropped;

CREATE TEMP TABLE _lm_rpc_before ON COMMIT DROP AS
SELECT p.oid, to_jsonb(p) AS zapis
FROM pg_proc p
WHERE p.oid IN (
    'public.dodaj_majice(text,text,text,integer)'::regprocedure,
    'public.dodaj_majice_sa_minimumom(text,text,text,integer,integer)'
        ::regprocedure
);

-- Postojeci vlasnici, ACL i RLS status tabela i sekvence.
CREATE TEMP TABLE _lm_security_before ON COMMIT DROP AS
SELECT oid, relowner, relacl::text AS acl,
       relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid IN (
    'public.majice'::regclass,
    'public.lager_urednici'::regclass,
    'public.majice_id_seq'::regclass
);

CREATE TEMP TABLE _lm_column_acl_before ON COMMIT DROP AS
SELECT attrelid, attnum, attacl::text AS acl
FROM pg_attribute
WHERE attrelid IN (
    'public.majice'::regclass,
    'public.lager_urednici'::regclass
)
  AND attnum > 0 AND NOT attisdropped;

CREATE TEMP TABLE _lm_policies_before ON COMMIT DROP AS
SELECT oid, to_jsonb(p) AS zapis
FROM pg_policy p
WHERE polrelid IN (
    'public.majice'::regclass,
    'public.lager_urednici'::regclass
);

CREATE TEMP TABLE _lm_sequence_before ON COMMIT DROP AS
SELECT seqrelid, to_jsonb(s) AS zapis
FROM pg_sequence s
WHERE seqrelid = 'public.majice_id_seq'::regclass;

CREATE FUNCTION public.majice_canonical_model_v4(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
SET search_path TO pg_catalog
AS $model$
    SELECT CASE lower(
        regexp_replace(
            regexp_replace(
                normalize(value, NFD),
                U&'[\0300-\036F]', '', 'g'
            ),
            '[[:space:]]', '', 'g'
        )
    )
        WHEN 'muska' THEN 'Muška'
        WHEN 'zenska' THEN 'Ženska'
        WHEN 'djecja' THEN 'Dječija'
        WHEN 'djecija' THEN 'Dječija'
        ELSE value
    END
$model$;

CREATE FUNCTION public.majice_canonical_size_v4(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
SET search_path TO pg_catalog
AS $size$
    SELECT CASE
        WHEN upper(btrim(value)) IN ('XS','S','M','L','XL')
            THEN upper(btrim(value))
        WHEN upper(btrim(value)) ~ '^X{2,}L$'
            THEN (length(btrim(value)) - 1)::text || 'XL'
        WHEN upper(btrim(value)) = '1XL'
            THEN 'XL'
        WHEN upper(btrim(value)) ~ '^[1-9][0-9]*XL$'
            THEN upper(btrim(value))
        ELSE value
    END
$size$;

CREATE FUNCTION public.majice_canonical_write_v4()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $write$
BEGIN
    NEW.model := public.majice_canonical_model_v4(NEW.model);
    NEW.velicina := public.majice_canonical_size_v4(NEW.velicina);
    RETURN NEW;
END
$write$;

-- Normalizuje ACL SAMO tri nove funkcije, nezavisno od default privileges.
-- Postojeci RPC, tabelarni, sekvencijski i globalni grantovi se ne diraju.
DO $new_function_acl$
DECLARE
    entry record;
BEGIN
    FOR entry IN
        SELECT DISTINCT p.oid::regprocedure AS signature, a.grantee
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(
            COALESCE(p.proacl, acldefault('f'::"char", p.proowner))
        ) a
        WHERE p.oid IN (
            'public.majice_canonical_model_v4(text)'::regprocedure,
            'public.majice_canonical_size_v4(text)'::regprocedure,
            'public.majice_canonical_write_v4()'::regprocedure
        ) AND a.grantee <> p.proowner
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %s',
            entry.signature,
            CASE WHEN entry.grantee=0 THEN 'PUBLIC'
                 ELSE quote_ident(pg_get_userbyid(entry.grantee)) END
        );
    END LOOP;
END
$new_function_acl$;
GRANT EXECUTE ON FUNCTION public.majice_canonical_model_v4(text),
    public.majice_canonical_size_v4(text), public.majice_canonical_write_v4()
    TO PUBLIC;

DO $data_checks$
DECLARE
    konflikti jsonb;
BEGIN
    -- Provjera tacnog rezultata ACL normalizacije samo novih funkcija.
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(
            COALESCE(p.proacl, acldefault('f'::"char", p.proowner))
        ) a
        WHERE p.oid IN (
            'public.majice_canonical_model_v4(text)'::regprocedure,
            'public.majice_canonical_size_v4(text)'::regprocedure,
            'public.majice_canonical_write_v4()'::regprocedure
        )
          AND (
              a.grantee NOT IN (0, p.proowner)
              OR a.privilege_type <> 'EXECUTE'
              OR a.is_grantable
          )
    ) THEN
        RAISE EXCEPTION
            'ACL novih funkcija odstupa od pregledanog rezultata.';
    END IF;

    SELECT jsonb_agg(to_jsonb(x))
    INTO konflikti
    FROM (
        SELECT
            lower(btrim(public.majice_canonical_model_v4(model)))
                AS model_kljuc,
            lower(btrim(boja)) AS boja_kljuc,
            upper(btrim(public.majice_canonical_size_v4(velicina)))
                AS velicina_kljuc,
            array_agg(id ORDER BY id) AS id_jevi,
            count(*) AS broj
        FROM public.majice
        GROUP BY 1, 2, 3
        HAVING count(*) > 1
        ORDER BY 1, 2, 3
        LIMIT 20
    ) x;

    IF konflikti IS NOT NULL THEN
        RAISE EXCEPTION 'Kanonske kolizije; transakcija se prekida.'
            USING DETAIL = konflikti::text;
    END IF;

    -- Promjene starih redova ogranicene su na pregledani spisak.
    -- Kolicine/minimumi nisu hardkodirani: cuvaju se zatecene vrijednosti.
    IF EXISTS (
        SELECT 1
        FROM public.majice
        WHERE (
            model IS DISTINCT FROM
                public.majice_canonical_model_v4(model)
            OR velicina IS DISTINCT FROM
                public.majice_canonical_size_v4(velicina)
        )
        AND NOT (
            model = 'Muška majica'
            AND velicina = 'XXL'
            AND (
                (id = 30 AND boja = 'bijela')
                OR (id = 42 AND boja = 'crna')
            )
        )
    ) OR (
        SELECT count(*)
        FROM public.majice
        WHERE model = 'Muška majica'
          AND velicina = 'XXL'
          AND (
              (id = 30 AND boja = 'bijela')
              OR (id = 42 AND boja = 'crna')
          )
    ) <> 2 THEN
        RAISE EXCEPTION
            'Spisak za normalizaciju odstupa od pregledanih ID-jeva 30/42.';
    END IF;
END
$data_checks$;

CREATE UNIQUE INDEX majice_canonical_unique_v4
ON public.majice (
    lower(btrim(public.majice_canonical_model_v4(model))),
    lower(btrim(boja)),
    upper(btrim(public.majice_canonical_size_v4(velicina)))
);

CREATE TRIGGER majice_canonical_write_v4
BEFORE INSERT OR UPDATE ON public.majice
FOR EACH ROW
EXECUTE FUNCTION public.majice_canonical_write_v4();

UPDATE public.majice
SET model = public.majice_canonical_model_v4(model),
    velicina = public.majice_canonical_size_v4(velicina)
WHERE model IS DISTINCT FROM public.majice_canonical_model_v4(model)
   OR velicina IS DISTINCT FROM public.majice_canonical_size_v4(velicina);

DO $postconditions$
BEGIN
    -- Provjerava svaki red pojedinacno, a ne samo zbir kolicina.
    IF EXISTS (
        SELECT 1
        FROM _lm_rows_before b
        FULL JOIN public.majice m ON m.id = b.id
        WHERE b.id IS NULL OR m.id IS NULL
           OR m.kolicina IS DISTINCT FROM b.kolicina
           OR m.minimalna_kolicina IS DISTINCT FROM b.minimalna_kolicina
           OR m.boja IS DISTINCT FROM b.boja
           OR m.model IS DISTINCT FROM
                public.majice_canonical_model_v4(b.model)
           OR m.velicina IS DISTINCT FROM
                public.majice_canonical_size_v4(b.velicina)
    ) THEN
        RAISE EXCEPTION 'Neuspjela provjera ocuvanja svakog reda.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.majice
        WHERE model IS NULL OR model ~ '^[[:space:]]*$'
           OR boja IS NULL OR boja ~ '^[[:space:]]*$'
           OR velicina IS NULL OR velicina ~ '^[[:space:]]*$'
           OR kolicina IS NULL OR kolicina < 0
           OR minimalna_kolicina IS NULL OR minimalna_kolicina < 0
           OR model IS DISTINCT FROM public.majice_canonical_model_v4(model)
           OR velicina IS DISTINCT FROM public.majice_canonical_size_v4(velicina)
    ) THEN
        RAISE EXCEPTION 'Neispravni ili nestandardizovani zavrsni podaci.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _lm_rpc_before b
        LEFT JOIN pg_proc p ON p.oid = b.oid
        WHERE b.zapis IS DISTINCT FROM to_jsonb(p)
    ) THEN
        RAISE EXCEPTION 'Promijenjena je postojeca RPC funkcija ili njen ACL.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _lm_security_before b
        LEFT JOIN pg_class c ON c.oid = b.oid
        WHERE c.oid IS NULL
           OR c.relowner IS DISTINCT FROM b.relowner
           OR c.relacl::text IS DISTINCT FROM b.acl
           OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity
           OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity
    ) THEN
        RAISE EXCEPTION 'Promijenjen vlasnik, ACL ili RLS status.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _lm_column_acl_before b
        LEFT JOIN pg_attribute a
          ON a.attrelid = b.attrelid AND a.attnum = b.attnum
        WHERE a.attrelid IS NULL OR a.attacl::text IS DISTINCT FROM b.acl
    ) THEN
        RAISE EXCEPTION 'Promijenjen ACL kolone.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _lm_policies_before b
        FULL JOIN (
            SELECT oid, to_jsonb(p) AS zapis
            FROM pg_policy p
            WHERE polrelid IN (
                'public.majice'::regclass,
                'public.lager_urednici'::regclass
            )
        ) p ON p.oid = b.oid
        WHERE b.zapis IS DISTINCT FROM p.zapis
    ) THEN
        RAISE EXCEPTION 'Promijenjena su RLS pravila.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _lm_sequence_before b
        LEFT JOIN pg_sequence s ON s.seqrelid = b.seqrelid
        WHERE b.zapis IS DISTINCT FROM to_jsonb(s)
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = 'public.majice'::regclass
          AND attname = 'id'
          AND atttypid = 'bigint'::regtype
          AND attnotnull AND attidentity = 'd'
    ) OR pg_get_serial_sequence('public.majice', 'id')
         IS DISTINCT FROM 'public.majice_id_seq' THEN
        RAISE EXCEPTION 'Promijenjene su IDENTITY postavke ili sekvenca.';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_index
        WHERE indrelid = 'public.majice'::regclass
          AND indexrelid IN (
              'public.majice_jedinstvena_stavka'::regclass,
              'public.majice_canonical_unique_v4'::regclass
          )
          AND indisunique AND indisvalid AND indisready
    ) <> 2 THEN
        RAISE EXCEPTION 'Jedinstveni indeksi nisu ispravni.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.majice'::regclass
          AND tgname = 'majice_canonical_write_v4'
          AND tgfoid = 'public.majice_canonical_write_v4()'::regprocedure
          AND tgenabled = 'O'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Normalizacijski trigger nije aktivan.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM _lm_structure_before b
        FULL JOIN (
            SELECT a.attnum, a.attname, a.atttypid, a.atttypmod,
                   a.attnotnull, a.attidentity, a.attgenerated,
                   pg_get_expr(d.adbin, d.adrelid) AS default_expr
            FROM pg_attribute a
            LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid='public.majice'::regclass
              AND a.attnum>0 AND NOT a.attisdropped
        ) a USING (attnum)
        WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(a)
    ) THEN
        RAISE EXCEPTION 'Promijenjen tip, NULL, DEFAULT ili IDENTITY kolone.';
    END IF;
END
$postconditions$;

-- Izvjestaji se generisu tek nakon uspjesnih provjera.
SELECT
    b.id,
    b.model AS stari_model,
    m.model AS novi_model,
    b.velicina AS stara_velicina,
    m.velicina AS nova_velicina,
    b.kolicina AS stara_kolicina,
    m.kolicina AS nova_kolicina,
    b.minimalna_kolicina AS stari_minimum,
    m.minimalna_kolicina AS novi_minimum
FROM _lm_rows_before b
JOIN public.majice m USING (id)
WHERE b.model IS DISTINCT FROM m.model
   OR b.velicina IS DISTINCT FROM m.velicina
ORDER BY b.id;

SELECT
    (SELECT count(*) FROM _lm_rows_before) AS broj_redova_prije,
    count(*) AS broj_redova_poslije,
    sum(kolicina) AS ukupna_kolicina_poslije,
    sum(minimalna_kolicina) AS ukupni_minimum_poslije
FROM public.majice;

-- NACRT: sve prethodne promjene se ponistavaju.
ROLLBACK;

-- COMMIT NAMJERNO NIJE UKLJUCEN.
