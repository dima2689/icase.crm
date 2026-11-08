/* Подключение к базе Supabase. Это публичный (anon) ключ: он нужен браузеру и не даёт доступа к данным без входа сотрудника.
   Секретный ключ service_role сюда класть нельзя. */
window.ICASE_CONFIG = {
  supabaseUrl: "https://wputkpwptwaxwzebszua.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwdXRrcHdwdHdheHd6ZWJzenVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMzYxODAsImV4cCI6MjEwOTcxMjE4MH0.1a-H0z3eoGi_8VQZ_wbrgbsx6vNsK_emz9nXc3J69hc"
};
