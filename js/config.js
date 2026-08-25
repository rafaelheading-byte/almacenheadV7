// =========================================================
// HEAD STORE — Supabase Config
// Reemplaza los valores con los de tu proyecto en .env
// =========================================================

const SUPABASE_URL = "https://djjgtydhqtykxgvevnsg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hxtIHeGV-8thmt-om1vwfg_BIy9CAkd";

// Inicialización segura del cliente Supabase.
// Si la librería CDN no se cargó correctamente, evitamos que el script lance una excepción
// y dejamos `db` en `null` para que el código consumidor lo detecte y muestre un error amigable.
let db = null;
if (typeof supabase !== 'undefined' && supabase && typeof supabase.createClient === 'function') {
	try {
		db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
	} catch (e) {
		console.error('Error al inicializar Supabase client:', e);
		db = null;
	}
} else {
	console.error('Supabase JS no está disponible. Asegura incluir la librería CDN antes de `js/config.js`.');
}
