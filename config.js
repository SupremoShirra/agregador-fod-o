// Cole aqui os dados do SEU projeto no Supabase (Project Settings → API).
// A chave "anon"/"publishable" é pública por natureza: quem protege os dados são as regras do schema.sql.
// NUNCA cole aqui a chave "service_role" / "secret".
window.CONFIG = {
  SUPABASE_URL: 'https://dauemirsmqkpoqnsoyli.supabase.co/rest/v1/',
  SUPABASE_ANON_KEY: 'sb_publishable_vzmtu60ZaNDbOw4PtE5MEg_4ijjJ2Sn',
  // O Supabase exige e-mail; o site monta um e-mail falso a partir do usuário. Nenhum e-mail é enviado.
  EMAIL_DOMAIN: 'usuarios.bancada.app'
};
