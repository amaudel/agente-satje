// Ejecuta `fn` sobre `items` con un maximo de `limite` promesas en vuelo,
// preservando el orden de los resultados.
//
// Reemplaza a Promise.all cuando el tamano de la lista lo controla el usuario:
// sin tope, 100 personas x N causas disparan miles de peticiones simultaneas
// contra el backend SATJE y contra el VPS propio (auto-DoS y riesgo de que
// SATJE bloquee la IP).
export async function mapConcurrente<T, R>(
  items: T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>
): Promise<R[]> {
  const resultados = new Array<R>(items.length);
  if (items.length === 0) return resultados;

  const ancho = Math.max(1, Math.min(Math.floor(limite) || 1, items.length));
  let siguiente = 0;

  const trabajadores = Array.from({ length: ancho }, async () => {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      resultados[i] = await fn(items[i], i);
    }
  });

  await Promise.all(trabajadores);
  return resultados;
}
