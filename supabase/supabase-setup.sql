-- Trip Studio · מבנה נתונים משפחתי
-- להריץ ב-Supabase → SQL Editor. בטוח להרצה חוזרת.
create extension if not exists pgcrypto;

-- ========== טבלאות ==========
create table if not exists public.trip_shared_data (
  trip_id text not null,
  data_key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (trip_id, data_key)
);

create table if not exists public.trip_stories (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null,
  author text not null default '',
  title text default '',
  body text default '',
  day_key text default '',
  day_title text default '',
  location_name text default '',
  lat double precision,
  lng double precision,
  visit_date timestamptz not null default now(),
  images jsonb not null default '[]'::jsonb,
  image_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trip_stories_trip_idx on public.trip_stories (trip_id, day_key);

create table if not exists public.family_live_locations (
  trip_id text not null,
  member_id text not null,
  member_name text not null,
  avatar text default '📍',
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  sharing boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (trip_id, member_id)
);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('trip-story-images','trip-story-images',true,10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=true, file_size_limit=10485760;

-- ========== נעילה מלאה ==========
-- אף אחד לא יכול לקרוא או לכתוב ישירות בטבלאות, גם עם המפתח הציבורי.
-- הגישה היחידה היא דרך הפונקציות למטה, שדורשות מזהה טיול מדויק.
alter table public.trip_shared_data      enable row level security;
alter table public.trip_stories          enable row level security;
alter table public.family_live_locations enable row level security;

do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies
           where schemaname='public'
             and tablename in ('trip_shared_data','trip_stories','family_live_locations')
  loop execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop;
end $$;

revoke all on public.trip_shared_data, public.trip_stories, public.family_live_locations from anon, authenticated;

-- ========== גישה מבוקרת ==========
create or replace function public.trip_get(p_trip text, p_key text)
returns jsonb language sql security definer set search_path=public as $$
  select value from public.trip_shared_data where trip_id=p_trip and data_key=p_key;
$$;

create or replace function public.trip_set(p_trip text, p_key text, p_value jsonb)
returns void language sql security definer set search_path=public as $$
  insert into public.trip_shared_data (trip_id,data_key,value,updated_at)
  values (p_trip,p_key,p_value,now())
  on conflict (trip_id,data_key) do update set value=excluded.value, updated_at=now();
$$;

create or replace function public.story_list(p_trip text, p_day text)
returns setof public.trip_stories language sql security definer set search_path=public as $$
  select * from public.trip_stories
  where trip_id=p_trip and (p_day is null or p_day='' or day_key=p_day)
  order by visit_date asc;
$$;

create or replace function public.story_add(
  p_trip text, p_day text, p_day_title text, p_author text,
  p_place text, p_images jsonb, p_paths jsonb)
returns public.trip_stories language plpgsql security definer set search_path=public as $$
declare r public.trip_stories;
begin
  if (select count(*) from public.trip_stories where trip_id=p_trip) > 400 then
    raise exception 'too many stories for this trip';
  end if;
  insert into public.trip_stories (trip_id,day_key,day_title,author,location_name,images,image_paths,visit_date)
  values (p_trip,p_day,coalesce(p_day_title,''),coalesce(p_author,''),coalesce(p_place,''),
          coalesce(p_images,'[]'::jsonb),coalesce(p_paths,'[]'::jsonb),now())
  returning * into r;
  return r;
end $$;

create or replace function public.story_del(p_trip text, p_id uuid)
returns void language sql security definer set search_path=public as $$
  delete from public.trip_stories where id=p_id and trip_id=p_trip;
$$;

create or replace function public.photo_count(p_trip text)
returns integer language sql security definer set search_path=public as $$
  select coalesce(sum(jsonb_array_length(images)),0)::int
  from public.trip_stories where trip_id=p_trip;
$$;

grant execute on function public.trip_get(text,text), public.trip_set(text,text,jsonb),
  public.story_list(text,text), public.story_add(text,text,text,text,text,jsonb,jsonb),
  public.story_del(text,uuid), public.photo_count(text) to anon, authenticated;

-- ========== תמונות ==========
drop policy if exists "story images read"   on storage.objects;
drop policy if exists "story images write"  on storage.objects;
drop policy if exists "story images delete" on storage.objects;
create policy "story images read"   on storage.objects for select using (bucket_id='trip-story-images');
create policy "story images write"  on storage.objects for insert with check (bucket_id='trip-story-images');
create policy "story images delete" on storage.objects for delete using (bucket_id='trip-story-images');
