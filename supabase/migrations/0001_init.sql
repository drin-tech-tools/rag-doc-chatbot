create extension if not exists vector;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- gemini-embedding-001 truncated to 768 dims (outputDimensionality)
create table if not exists chunks (
  id bigserial primary key,
  document_id uuid references documents(id) on delete cascade,
  page int not null,
  chunk_index int not null,
  content text not null,
  embedding vector(768) not null
);

create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

create or replace function match_chunks(query_embedding vector(768), match_count int default 5, filter_document uuid default null)
returns table (id bigint, document_id uuid, document_name text, page int, content text, similarity float)
language sql stable as $$
  select c.id, c.document_id, d.name, c.page, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from chunks c join documents d on d.id = c.document_id
  where filter_document is null or c.document_id = filter_document
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
