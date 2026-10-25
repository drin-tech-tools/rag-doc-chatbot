-- Shared RBAC + document ownership for rag-doc-chatbot (same Supabase project as job-hunt-agent).
-- Idempotent: safe if the other app creates identical objects.

-- Roles scoped per app in one shared project
create table if not exists public.user_roles (
  user_id uuid references auth.users on delete cascade,
  app text check (app in ('rag-doc-chatbot', 'job-hunt-agent')),
  role text check (role in ('admin', 'client')),
  primary key (user_id, app)
);

create index if not exists user_roles_app_idx on public.user_roles (app);

-- Document ownership
alter table public.documents
  add column if not exists owner_id uuid references auth.users (id) on delete set null;

create index if not exists documents_owner_id_idx on public.documents (owner_id);

-- Scoped vector search: pass filter_owner for non-admins; admins may pass null for all docs
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

-- RLS (defense in depth; app still uses service role with explicit filters)
alter table public.user_roles enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;

-- user_roles: users read own rows; no client writes (service role / admin API only)
drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_own on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());

-- documents: owners see/write own; admins of this app see all
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.app = 'rag-doc-chatbot'
        and ur.role = 'admin'
    )
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.app = 'rag-doc-chatbot'
        and ur.role = 'admin'
    )
  );

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.app = 'rag-doc-chatbot'
        and ur.role = 'admin'
    )
  );

-- chunks follow parent document visibility
drop policy if exists chunks_select on public.chunks;
create policy chunks_select on public.chunks
  for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = chunks.document_id
        and (
          d.owner_id = auth.uid()
          or exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.app = 'rag-doc-chatbot'
              and ur.role = 'admin'
          )
        )
    )
  );

drop policy if exists chunks_insert on public.chunks;
create policy chunks_insert on public.chunks
  for insert to authenticated
  with check (
    exists (
      select 1 from public.documents d
      where d.id = chunks.document_id
        and d.owner_id = auth.uid()
    )
  );

drop policy if exists chunks_delete on public.chunks;
create policy chunks_delete on public.chunks
  for delete to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = chunks.document_id
        and (
          d.owner_id = auth.uid()
          or exists (
            select 1 from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.app = 'rag-doc-chatbot'
              and ur.role = 'admin'
          )
        )
    )
  );

grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, delete on public.chunks to authenticated;
grant usage, select on sequence public.chunks_id_seq to authenticated;
