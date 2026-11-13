-- SELECT ONLY. Optional fresh audit; migration repeats checks under lock.
WITH canonical AS (
 SELECT *,
  CASE lower(regexp_replace(regexp_replace(normalize(model,NFD),U&'[\0300-\036F]','','g'),'[[:space:]]','','g'))
   WHEN 'muska' THEN 'Muška' WHEN 'zenska' THEN 'Ženska'
   WHEN 'djecja' THEN 'Dječija' WHEN 'djecija' THEN 'Dječija' ELSE model END AS proposed_model,
  CASE WHEN upper(btrim(velicina)) IN ('XS','S','M','L','XL') THEN upper(btrim(velicina))
   WHEN upper(btrim(velicina)) ~ '^X{2,}L$' THEN (length(btrim(velicina))-1)::text||'XL'
   WHEN upper(btrim(velicina))='1XL' THEN 'XL'
   WHEN upper(btrim(velicina)) ~ '^[1-9][0-9]*XL$' THEN upper(btrim(velicina))
   ELSE velicina END AS proposed_size
 FROM public.majice
), collisions AS (
 SELECT array_agg(id ORDER BY id) AS ids
 FROM canonical
 WHERE proposed_model IS NOT NULL AND boja IS NOT NULL AND proposed_size IS NOT NULL
 GROUP BY lower(btrim(proposed_model)),lower(btrim(boja)),upper(btrim(proposed_size))
 HAVING count(*)>1
), invalid AS (
 SELECT id FROM canonical WHERE model IS NULL OR model ~ '^[[:space:]]*$'
 OR boja IS NULL OR boja ~ '^[[:space:]]*$'
 OR velicina IS NULL OR velicina ~ '^[[:space:]]*$'
 OR kolicina IS NULL OR kolicina<0 OR minimalna_kolicina IS NULL OR minimalna_kolicina<0
)
SELECT
 (SELECT count(*) FROM canonical) AS row_count,
 (SELECT count(*) FROM invalid) AS invalid_rows,
 (SELECT count(*) FROM collisions) AS collision_groups,
 (SELECT jsonb_agg(ids) FROM collisions) AS collision_ids,
 (SELECT jsonb_agg(jsonb_build_object('id',id,'old_model',model,'new_model',proposed_model,
  'old_size',velicina,'new_size',proposed_size,'quantity',kolicina,'minimum',minimalna_kolicina) ORDER BY id)
  FROM canonical WHERE model IS DISTINCT FROM proposed_model OR velicina IS DISTINCT FROM proposed_size) AS proposed_changes;
