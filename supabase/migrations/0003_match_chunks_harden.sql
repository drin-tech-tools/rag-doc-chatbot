-- Harden match_chunks for PostgREST + service-role RAG:
-- 1) Drop the legacy 3-arg overload from 0001 (CREATE OR REPLACE with a new
--    argument does not replace it; two overloads confuse clients).
-- 2) Recreate the scoped 4-arg function with a statement timeout.
-- 3) Grant EXECUTE to service_role (chat/upload) and authenticated.

drop function if exists public.match_chunks(vector(768), int, uuid);

create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count int default 5,
  filter_document uuid default null,
  filter_owner uuid default null
)
returns table (
  id bigint,
  document_id uuid,
  document_name text,
  page int,
  content text,
  similarity float
)
language sql
stable
set statement_timeout to '8s'
as $$
  select
    c.id,
    c.document_id,
    d.name,
    c.page,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where (filter_document is null or c.document_id = filter_document)
    and (filter_owner is null or d.owner_id = filter_owner)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_chunks(vector(768), int, uuid, uuid) from public;
grant execute on function public.match_chunks(vector(768), int, uuid, uuid)
  to service_role, authenticated;
