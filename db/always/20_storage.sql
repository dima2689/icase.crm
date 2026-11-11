-- Повторяемый файл: хранилище фото ремонта (бакет и права). Выполняется при каждой выкладке и после восстановления.
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('repair-photos', 'repair-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
      on conflict (id) do nothing;
    execute 'drop policy if exists repair_photos_read on storage.objects';
    execute 'create policy repair_photos_read on storage.objects for select to authenticated using (bucket_id = ''repair-photos'' and (select public.is_staff()))';
    execute 'drop policy if exists repair_photos_write on storage.objects';
    execute 'create policy repair_photos_write on storage.objects for insert to authenticated with check (bucket_id = ''repair-photos'' and (select public.has_role(''owner'',''manager'',''seller'',''master'')))';
    execute 'drop policy if exists repair_photos_del on storage.objects';
    execute 'create policy repair_photos_del on storage.objects for delete to authenticated using (bucket_id = ''repair-photos'' and (select public.has_role(''owner'',''manager'')))';
  end if;
end $$;
