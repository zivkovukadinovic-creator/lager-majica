-- SELECT ONLY. Expected: two valid indexes, one enabled canonical trigger,
-- unchanged RPC definitions/security/ACL, and unchanged quantities from migration report.
SELECT id,model,boja,velicina,kolicina,minimalna_kolicina
FROM public.majice WHERE id IN (30,42) ORDER BY id;
SELECT indexrelid::regclass AS index_name,indisunique,indisvalid,indisready
FROM pg_index WHERE indrelid='public.majice'::regclass
AND indexrelid IN (to_regclass('public.majice_jedinstvena_stavka'),to_regclass('public.majice_canonical_unique_v4'));
SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE tgrelid='public.majice'::regclass AND NOT tgisinternal;
SELECT public.majice_canonical_size_v4('XXL')='2XL' AS size_ready,
 public.majice_canonical_model_v4('Muska')='Muška' AS model_ready;
SELECT p.oid::regprocedure AS signature,pg_get_userbyid(proowner) AS owner,
 prosecdef,proconfig,proacl::text,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p WHERE p.oid IN (
 'public.dodaj_majice(text,text,text,integer)'::regprocedure,
 'public.dodaj_majice_sa_minimumom(text,text,text,integer,integer)'::regprocedure);
SELECT column_name,data_type,is_nullable,column_default,is_identity,identity_generation
FROM information_schema.columns WHERE table_schema='public' AND table_name='majice'
ORDER BY ordinal_position;
