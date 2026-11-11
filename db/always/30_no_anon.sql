-- Повторяемый файл: у анонима (ключ anon без входа) нет прав ни на что в схеме public.
-- Сайт и интеграции ходят через edge-функции с service_role. Защищает от прав «по умолчанию»
-- у новых объектов (миграции, восстановление из копии).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
