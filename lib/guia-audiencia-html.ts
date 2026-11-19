// Pagina del formulario "Preparar guia de audiencia". Llega prellenada con lo
// que se pudo leer del SATJE; la abogada completa los datos del credito y marca
// las excepciones que planteo el deudor. El Word se arma en el servidor
// (?action=guia-audiencia-docx) y se descarga sin salir de la pagina.
import type { PrellenadoGuia } from "./guia-audiencia.js";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function generarGuiaAudienciaHTML(causa: string, pre: PrellenadoGuia | null, aviso?: string): string {
  const inicial = {
    causa,
    ...(pre ?? {}),
  };
  // JSON dentro de <script type="application/json">: se escapa "<" para que nada cierre la etiqueta.
  const json = JSON.stringify(inicial).replace(/</g, "\\u003c");
  const detectado: string[] = [];
  if (pre?.deudores.length) detectado.push(`${pre.deudores.length} deudor(es)`);
  if (pre?.montoPagare) detectado.push("valor del pagaré");
  if (pre?.fechaPresentacionDemanda) detectado.push("fecha de la demanda");
  if (pre?.contestacionConocida) detectado.push("quién contestó");
  if (pre?.audienciaConvocada) detectado.push("fecha de la audiencia");
  if (pre?.tratoSeguro) detectado.push(pre.trato === "jueza" ? "Señora Jueza" : "Señor Juez");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guía de audiencia · ${esc(causa)}</title>
<style>
  :root { --bg:#0b1220; --card:#111a2e; --borde:#24324f; --texto:#e2e8f0; --suave:#94a3b8; --acento:#38bdf8; --ok:#22c55e; --alerta:#f59e0b; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--texto); line-height:1.45; }
  main { max-width: 860px; margin: 0 auto; padding: 1.2rem 1rem 4rem; }
  h1 { font-size:1.45rem; margin:.2rem 0 .2rem; }
  h2 { font-size:1.05rem; margin:0 0 .8rem; color:var(--acento); letter-spacing:.02em; }
  a { color: var(--acento); }
  .sub { color:var(--suave); margin:0 0 1rem; }
  .card { background:var(--card); border:1px solid var(--borde); border-radius:14px; padding:1rem 1.1rem; margin:0 0 1rem; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:.8rem; }
  label { display:block; font-size:.86rem; color:var(--suave); }
  input[type=text], input[type=date], input[type=number], select {
    width:100%; margin-top:.25rem; padding:.55rem .65rem; border-radius:9px; border:1px solid var(--borde);
    background:#0b1324; color:var(--texto); font-size:1rem; }
  input:focus, select:focus { outline:2px solid var(--acento); outline-offset:1px; }
  .chk { display:flex; gap:.55rem; align-items:flex-start; padding:.55rem .6rem; border:1px solid var(--borde); border-radius:10px; cursor:pointer; color:var(--texto); font-size:.95rem; }
  .chk input { margin-top:.2rem; width:1.1rem; height:1.1rem; flex:none; }
  .chk small { display:block; color:var(--suave); }
  .modulos { display:grid; gap:.55rem; }
  .extra { margin:.6rem 0 0 1.6rem; display:none; }
  .extra.visible { display:block; }
  .deudor { display:grid; grid-template-columns: 1fr 150px 130px 34px; gap:.5rem; align-items:end; margin-bottom:.5rem; }
  .deudor .chk { padding:.45rem .5rem; }
  .btn { background:var(--acento); color:#04121f; border:0; border-radius:10px; padding:.75rem 1.2rem; font-weight:700; font-size:1rem; cursor:pointer; }
  .btn.sec { background:transparent; color:var(--acento); border:1px solid var(--acento); padding:.45rem .8rem; font-size:.9rem; }
  .btn.x { background:transparent; color:var(--suave); border:1px solid var(--borde); padding:.45rem; }
  .btn[disabled] { opacity:.6; cursor:wait; }
  .pista { font-size:.82rem; color:var(--suave); margin:.35rem 0 0; }
  .detectado { border-left:5px solid var(--ok); }
  .aviso { border-left:5px solid var(--alerta); }
  #resultado ul { margin:.4rem 0 0 1.1rem; padding:0; }
  .barra { position:sticky; bottom:0; background:linear-gradient(transparent, var(--bg) 35%); padding:1.2rem 0 .6rem; display:flex; gap:.8rem; align-items:center; flex-wrap:wrap; }
  .ia-campo { border-color:#a78bfa !important; box-shadow: 0 0 0 1px #a78bfa inset; }
  .ia-tag { color:#c4b5fd; font-size:.8rem; }
  .ia-card { border-left:5px solid #a78bfa; }
  .ia-lista { list-style:none; margin:.4rem 0 0; padding:0; display:grid; gap:.45rem; }
  .ia-lista label { display:flex; gap:.5rem; align-items:flex-start; color:var(--texto); font-size:.93rem; }
  .ia-lista input { margin-top:.25rem; flex:none; }
  input[type=file] { color:var(--texto); margin:.3rem 0 .6rem; }
  @media (max-width: 620px) { .deudor { grid-template-columns: 1fr 1fr; } .deudor .nom { grid-column: 1 / -1; } }
</style>
</head>
<body>
<main>
  <a href="/?causa=${encodeURIComponent(causa)}">← Volver al juicio</a>
  <h1>📝 Guía de audiencia única</h1>
  <p class="sub">Juicio <strong>${esc(causa)}</strong>. Se arma un borrador en Word con la estructura de las guías del área legal. Lo que falte queda resaltado en amarillo como <strong>[COMPLETAR]</strong>.</p>

  ${aviso ? `<div class="card aviso">${esc(aviso)}</div>` : ""}
  ${
    detectado.length
      ? `<div class="card detectado"><strong>✅ Tomado del SATJE:</strong> ${esc(detectado.join(", "))}. Revísalo; puedes cambiar cualquier dato.
      <p class="pista">La demanda se entregó en papel y el SATJE no tiene su texto. Los datos del crédito y las excepciones se llenan aquí, a mano o leyendo la contestación con IA.</p></div>`
      : ""
  }

  <form id="f" autocomplete="off">
    <section class="card ia-card">
      <h2>🤖 Leer la contestación con IA (opcional)</h2>
      <p class="pista" style="margin-top:0">Sube el PDF de la contestación del deudor (descárgalo del SATJE, en "Anexos" del escrito) o fotos de sus páginas. La IA marca las excepciones, llena los datos que encuentre y prepara respuestas para el alegato. <strong>Cuesta unos centavos por lectura.</strong></p>
      <input type="file" id="archivoContestacion" accept="application/pdf,image/jpeg,image/png,image/webp" multiple>
      <div style="display:flex; gap:.7rem; align-items:center; flex-wrap:wrap">
        <button type="button" class="btn sec" id="leerIA">Leer con IA</button>
        <span class="pista" id="estadoIA" style="margin:0"></span>
      </div>
      <div id="resultadoIA"></div>
    </section>

    <section class="card">
      <h2>1. Audiencia</h2>
      <div class="grid">
        <label>Abogada que va a la audiencia
          <select name="abogada"><option value="diana">Diana Vera Saraguro</option><option value="veronica">Verónica González Vásquez</option></select></label>
        <label>Trato a quien preside
          <select name="trato"><option value="juez">Señor Juez</option><option value="jueza">Señora Jueza</option></select></label>
        <label>Juez(a)<input type="text" name="juezNombre"></label>
        <label>Fecha de la audiencia<input type="text" name="audienciaFecha" placeholder="ej. 18 de noviembre de 2026"></label>
        <label>Hora<input type="text" name="audienciaHora" placeholder="11H00"></label>
        <label>Sala<input type="text" name="audienciaSala"></label>
      </div>
    </section>

    <section class="card">
      <h2>2. Deudores</h2>
      <div id="deudores"></div>
      <button type="button" class="btn sec" id="masDeudor">+ Agregar deudor</button>
      <p class="pista">Marca "Contestó" en quienes presentaron contestación. A los que no contestaron se les menciona al pedir el pago.</p>
    </section>

    <section class="card">
      <h2>3. Datos del crédito</h2>
      <div class="grid">
        <label>Número de pagaré<input type="text" name="numeroPagare"></label>
        <label>Número de endoso (si tiene)<input type="text" name="numeroEndoso"></label>
        <label>Fecha de suscripción<input type="date" name="fechaSuscripcion"></label>
        <label>Monto del pagaré (USD)<input type="text" name="montoPagare" inputmode="decimal" placeholder="6500,00"></label>
        <label>Tasa anual (%)<input type="text" name="tasa" inputmode="decimal" placeholder="17.5"></label>
        <label>Tipo de crédito<input type="text" name="tipoCredito" list="tiposCredito" placeholder="microcrédito"></label>
        <label>Plazo<input type="number" name="plazo" min="1" max="600"></label>
        <label>El plazo está en
          <select name="unidadPlazo"><option value="dividendos">dividendos</option><option value="meses">meses</option></select></label>
        <label>Dividendos pagados<input type="number" name="dividendosPagados" min="0"></label>
        <label>En mora desde el dividendo<input type="number" name="dividendoMora" min="1"></label>
        <label>Fecha de ese dividendo<input type="date" name="fechaMora"></label>
        <label>Saldo de capital (USD)<input type="text" name="saldoCapital" inputmode="decimal" placeholder="4319,10"></label>
        <label>Presentación de la demanda<input type="date" name="fechaPresentacionDemanda"></label>
      </div>
      <datalist id="tiposCredito"><option value="microcrédito"><option value="crédito de consumo prioritario"><option value="crédito de consumo ordinario"><option value="microcrédito de acumulación ampliada"><option value="crédito inmobiliario"></datalist>
      <div class="modulos" style="margin-top:.8rem">
        <label class="chk"><input type="checkbox" name="seguroDesgravamen" checked> Reclamar seguro de desgravamen</label>
        <label class="chk"><input type="checkbox" name="reconoceDeuda"> <span>El deudor reconoce la deuda en su contestación<small>Agrega ese argumento en las excepciones y en el alegato final.</small></span></label>
      </div>
    </section>

    <section class="card">
      <h2>4. ¿Qué excepciones planteó el deudor?</h2>
      <div class="modulos">
        <label class="chk"><input type="checkbox" name="m_legitimacion" data-extra="x_legitimacion"> Falta de legitimación / endoso del pagaré</label>
        <div class="extra grid" id="x_legitimacion">
          <label>Entidad que endosó el pagaré<input type="text" name="entidadOriginal" placeholder="la Cooperativa ... en liquidación"></label>
          <label>Fecha del endoso<input type="date" name="fechaEndoso"></label>
        </div>

        <label class="chk"><input type="checkbox" name="m_requisitos" data-extra="x_requisitos"> Al pagaré le faltan requisitos (arts. 187-188 Código de Comercio)</label>
        <div class="extra" id="x_requisitos">
          <label class="chk"><input type="checkbox" name="requisitoFechaLugar" checked> Dice que falta la fecha o el lugar de suscripción</label>
          <label class="chk" style="margin-top:.4rem"><input type="checkbox" name="requisitoLugarPago"> Dice que falta el lugar de pago</label>
        </div>

        <label class="chk"><input type="checkbox" name="m_falsedad" data-extra="x_falsedad"> Nulidad formal o falsedad del título</label>
        <div class="extra" id="x_falsedad">
          <p class="pista" style="margin:0 0 .4rem">¿A qué prueba del deudor hay que oponerse?</p>
          <label class="chk"><input type="checkbox" name="op_pericia"> Pericia de firmas</label>
          <label class="chk" style="margin-top:.4rem"><input type="checkbox" name="op_testigos"> Testigos</label>
          <label class="chk" style="margin-top:.4rem"><input type="checkbox" name="op_declaracionGerente"> Declaración del Gerente</label>
          <label class="chk" style="margin-top:.4rem"><input type="checkbox" name="op_oficios"> Oficios o certificados</label>
        </div>

        <label class="chk"><input type="checkbox" name="m_prescripcion" data-extra="x_prescripcion"> <span>Prescripción<small>La app revisa si los 5 años cuadran antes de poner cada argumento.</small></span></label>
        <div class="extra grid" id="x_prescripcion">
          <label>Fecha del último pago<input type="date" name="fechaUltimoPago"></label>
          <label>Dividendo que pagó ese día<input type="number" name="dividendoUltimoPago" min="1"></label>
          <label>Fecha de citación (opcional)<input type="date" name="fechaCitacion"></label>
        </div>

        <label class="chk"><input type="checkbox" name="m_diferimiento" data-extra="x_diferimiento"> El crédito tuvo diferimiento extraordinario de cuotas</label>
        <div class="extra grid" id="x_diferimiento">
          <label>Fecha de la solicitud de diferimiento<input type="date" name="fechaDiferimiento"></label>
        </div>
      </div>
      <p class="pista">Si no marcas ninguna, la guía sale sin la sección de excepciones (por ejemplo, si nadie contestó).</p>
    </section>

    <div id="resultado"></div>
    <div class="barra">
      <button type="submit" class="btn" id="generar">Generar guía en Word</button>
      <span class="pista">Generar el Word no usa IA: no tiene costo.</span>
    </div>
  </form>
</main>
<script type="application/json" id="inicial">${json}</script>
<script>
(function () {
  var ini = {};
  try { ini = JSON.parse(document.getElementById('inicial').textContent || '{}'); } catch (e) {}
  var f = document.getElementById('f');
  function campo(n) { return f.elements.namedItem(n); }
  function poner(n, v) { var c = campo(n); if (c && v !== undefined && v !== null && v !== '') c.value = v; }

  // ---- Deudores ----
  var cont = document.getElementById('deudores');
  function filaDeudor(d) {
    var fila = document.createElement('div');
    fila.className = 'deudor';
    fila.innerHTML =
      '<label class="nom">Nombre<input type="text" class="d-nombre"></label>' +
      '<label>Calidad<select class="d-rol"><option value="principal">Principal</option><option value="solidario">Solidario</option></select></label>' +
      '<label class="chk"><input type="checkbox" class="d-contesto"> Contestó</label>' +
      '<button type="button" class="btn x" title="Quitar">✕</button>';
    fila.querySelector('.d-nombre').value = (d && d.nombre) || '';
    fila.querySelector('.d-rol').value = (d && d.rol) || 'principal';
    fila.querySelector('.d-contesto').checked = Boolean(d && d.contesto);
    fila.querySelector('.btn.x').onclick = function () { fila.remove(); };
    cont.appendChild(fila);
  }
  var contestaron = (ini.contestaron || []).map(function (n) { return String(n).toUpperCase(); });
  (ini.deudores && ini.deudores.length ? ini.deudores : [{}]).forEach(function (d) {
    filaDeudor({ nombre: d.nombre, rol: d.rol, contesto: contestaron.indexOf(String(d.nombre || '').toUpperCase()) >= 0 });
  });
  document.getElementById('masDeudor').onclick = function () { filaDeudor({}); };

  // ---- Prellenado ----
  poner('abogada', ini.abogada);
  poner('trato', ini.trato);
  poner('juezNombre', ini.juezNombre);
  poner('audienciaFecha', ini.audienciaFecha);
  poner('audienciaHora', ini.audienciaHora);
  poner('audienciaSala', ini.audienciaSala);
  if (ini.montoPagare) poner('montoPagare', String(ini.montoPagare).replace('.', ','));
  poner('fechaPresentacionDemanda', ini.fechaPresentacionDemanda);

  // ---- Secciones que se abren al marcar una excepcion ----
  Array.prototype.forEach.call(f.querySelectorAll('input[data-extra]'), function (chk) {
    var caja = document.getElementById(chk.getAttribute('data-extra'));
    var sync = function () { caja.classList.toggle('visible', chk.checked); };
    chk.addEventListener('change', sync); sync();
  });

  function val(n) { var c = campo(n); return c ? (c.type === 'checkbox' ? c.checked : c.value) : undefined; }

  // ---- Lectura de la contestacion con IA ----
  var iaDatos = null;
  var estadoIA = document.getElementById('estadoIA');
  var cajaIA = document.getElementById('resultadoIA');

  function leerBase64(blob) {
    return new Promise(function (ok, mal) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { mal(new Error('No se pudo leer el archivo.')); };
      r.readAsDataURL(blob);
    });
  }
  // Las fotos del celular pesan mucho: se achican a 1600 px en JPEG antes de enviarlas.
  function achicarFoto(file) {
    return createImageBitmap(file).then(function (img) {
      var escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (ok) { c.toBlob(function (b) { ok(b); }, 'image/jpeg', 0.8); });
    }).then(function (blob) { return leerBase64(blob).then(function (d) { return { nombre: file.name, tipo: 'image/jpeg', datos: d }; }); });
  }
  function prepararArchivos(lista) {
    var files = Array.prototype.slice.call(lista);
    if (!files.length) return Promise.reject(new Error('Primero elige el PDF o las fotos de la contestación.'));
    var pdfs = files.filter(function (f) { return f.type === 'application/pdf'; });
    if (pdfs.length > 1 || (pdfs.length && pdfs.length !== files.length)) return Promise.reject(new Error('Sube un solo PDF, o solo fotos.'));
    if (pdfs.length) {
      if (pdfs[0].size > 3300000) return Promise.reject(new Error('El PDF pesa más de 3 MB. Sube fotos de las páginas principales (la app las achica) o un PDF más liviano.'));
      return leerBase64(pdfs[0]).then(function (d) { return [{ nombre: pdfs[0].name, tipo: 'application/pdf', datos: d }]; });
    }
    if (files.length > 15) return Promise.reject(new Error('Máximo 15 fotos.'));
    return Promise.all(files.map(achicarFoto));
  }

  // Solo se llenan casillas vacias: lo que ya escribio la abogada no se toca.
  var llenados = [];
  function sugerir(n, v, etiqueta) {
    var c = campo(n);
    if (!c || v === undefined || v === null || v === '' || String(c.value).trim() !== '') return;
    c.value = v; c.classList.add('ia-campo'); c.title = 'Leído por IA: revisar';
    llenados.push(etiqueta);
  }
  function marcar(n, v) {
    var c = campo(n);
    if (c && v && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); }
  }
  function aplicarIA(r) {
    llenados = [];
    var ex = r.excepciones || {}, pr = r.pruebaDeudor || {}, dc = r.datosCredito || {};
    marcar('m_legitimacion', ex.legitimacion); marcar('m_requisitos', ex.requisitos);
    marcar('m_falsedad', ex.falsedad); marcar('m_prescripcion', ex.prescripcion);
    if (ex.requisitos) { var fl = campo('requisitoFechaLugar'); if (fl) fl.checked = Boolean(ex.faltaFechaLugar); marcar('requisitoLugarPago', ex.faltaLugarPago); }
    marcar('op_pericia', pr.pericia); marcar('op_testigos', pr.testigos);
    marcar('op_declaracionGerente', pr.declaracionGerente); marcar('op_oficios', pr.oficios);
    // La oposicion a la prueba vive dentro del bloque de falsedad: se muestra aunque no haya esa excepcion.
    if ((pr.pericia || pr.testigos || pr.declaracionGerente || pr.oficios) && !ex.falsedad) document.getElementById('x_falsedad').classList.add('visible');
    marcar('reconoceDeuda', r.reconoceDeuda);
    sugerir('numeroPagare', dc.numeroPagare, 'número de pagaré');
    if (dc.montoPagare) sugerir('montoPagare', Number(dc.montoPagare).toFixed(2).replace('.', ','), 'monto');
    sugerir('fechaSuscripcion', dc.fechaSuscripcion, 'fecha de suscripción');
    sugerir('tasa', dc.tasa, 'tasa');
    sugerir('plazo', dc.plazo, 'plazo');
    sugerir('dividendoMora', dc.dividendoMora, 'dividendo en mora');
    sugerir('fechaMora', dc.fechaMora, 'fecha de mora');
    if (dc.saldoCapital) sugerir('saldoCapital', Number(dc.saldoCapital).toFixed(2).replace('.', ','), 'saldo de capital');
    sugerir('entidadOriginal', dc.entidadOriginal, 'entidad que endosó');
    sugerir('fechaEndoso', dc.fechaEndoso, 'fecha del endoso');
    sugerir('fechaUltimoPago', dc.fechaUltimoPago, 'fecha del último pago');
    if (dc.dividendoMora && !String(val('dividendosPagados') || '').trim()) sugerir('dividendosPagados', dc.dividendoMora - 1, 'dividendos pagados');
  }

  function itemsMarcables(lista, clase, texto) {
    return '<ul class="ia-lista">' + lista.map(function (x, i) {
      return '<li><label><input type="checkbox" class="' + clase + '" data-i="' + i + '" checked><span>' + texto(x) + '</span></label></li>';
    }).join('') + '</ul>';
  }
  function pintarIA(r, uso) {
    var ex = r.excepciones || {};
    var nombres = [];
    if (ex.legitimacion) nombres.push('falta de legitimación / endoso');
    if (ex.requisitos) nombres.push('requisitos del pagaré');
    if (ex.falsedad) nombres.push('nulidad o falsedad del título');
    if (ex.prescripcion) nombres.push('prescripción');
    (ex.otras || []).forEach(function (o) { nombres.push(o.nombre + ' (sin texto modelo)'); });
    var pag = function (n) { return n ? ' <span class="ia-tag">pág. ' + n + '</span>' : ''; };
    var h = '<div class="card ia-card" style="margin-top:.8rem">';
    (r.advertencias || []).forEach(function (a) { h += '<p>⚠️ ' + esc(a) + '</p>'; });
    h += '<p style="margin-top:0"><strong>Contesta:</strong> ' + esc(r.quienContesta || 'no se identificó') + '</p>';
    h += '<p><strong>Excepciones encontradas:</strong> ' + esc(nombres.length ? nombres.join(', ') : 'ninguna') + '. Ya quedaron marcadas abajo.</p>';
    if (r.reconoceDeuda) h += '<p><strong>Reconoce la deuda:</strong> sí' + (r.reconoceDeudaCita ? ' — <em>"' + esc(r.reconoceDeudaCita) + '"</em>' : '') + '</p>';
    if (r.pruebaDeudor && r.pruebaDeudor.detalle && r.pruebaDeudor.detalle.length) h += '<p><strong>Prueba que pidió el deudor:</strong> ' + esc(r.pruebaDeudor.detalle.join('; ')) + '</p>';
    h += '<p><strong>Datos llenados</strong> <span class="ia-tag">(borde morado, revisar)</span>: ' + esc(llenados.length ? llenados.join(', ') : 'ninguno nuevo') + '</p>';
    if (r.puntosARebatir && r.puntosARebatir.length) {
      h += '<p style="margin-bottom:0"><strong>Respuestas sugeridas para el alegato</strong> <span class="ia-tag">(desmarca las que no quieras en la guía)</span>:</p>';
      h += itemsMarcables(r.puntosARebatir, 'ia-punto', function (x) { return '<strong>Alega:</strong> ' + esc(x.argumento) + pag(x.pagina) + '<br><strong>Respuesta:</strong> ' + esc(x.respuesta); });
    }
    if (r.contradicciones && r.contradicciones.length) {
      h += '<p style="margin-bottom:0"><strong>Contradicciones y admisiones del deudor:</strong></p>';
      h += itemsMarcables(r.contradicciones, 'ia-contra', function (x) { return esc(x.texto) + pag(x.pagina); });
    }
    if (uso && typeof uso.costoUSD === 'number') h += '<p class="pista">Costo de esta lectura: aprox. USD ' + uso.costoUSD.toFixed(3) + '.</p>';
    h += '</div>';
    cajaIA.innerHTML = h;
  }
  function aportesIA() {
    if (!iaDatos) return undefined;
    var elegidos = function (clase, lista) {
      return Array.prototype.filter.call(cajaIA.querySelectorAll('.' + clase), function (c) { return c.checked; })
        .map(function (c) { return lista[Number(c.getAttribute('data-i'))]; });
    };
    return {
      puntos: elegidos('ia-punto', iaDatos.puntosARebatir || []),
      contradicciones: elegidos('ia-contra', iaDatos.contradicciones || []),
      otrasExcepciones: (iaDatos.excepciones && iaDatos.excepciones.otras) || []
    };
  }

  document.getElementById('leerIA').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true; cajaIA.innerHTML = '';
    estadoIA.textContent = 'Preparando el archivo…';
    prepararArchivos(document.getElementById('archivoContestacion').files)
      .then(function (archivos) {
        estadoIA.textContent = 'La IA está leyendo la contestación (30 a 50 segundos)…';
        return fetch('/?action=leer-contestacion&format=json', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ action: 'leer-contestacion', causa: ini.causa, archivos: archivos })
        });
      })
      .then(function (r) {
        if (r.status === 413) throw new Error('El archivo es demasiado grande. Sube fotos de las páginas principales.');
        return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'No se pudo leer la contestación.'); return j; });
      })
      .then(function (j) {
        iaDatos = j.resultado;
        aplicarIA(iaDatos);
        pintarIA(iaDatos, j.uso);
        estadoIA.textContent = '✅ Listo. Revisa lo marcado y completa lo que falte.';
      })
      .catch(function (e) { estadoIA.textContent = ''; cajaIA.innerHTML = '<div class="card aviso" style="margin-top:.8rem">❌ ' + esc(e.message || e) + '</div>'; })
      .finally(function () { btn.disabled = false; });
  });

  var res = document.getElementById('resultado');
  function mostrar(html, clase) { res.innerHTML = '<div class="card ' + (clase || '') + '">' + html + '</div>'; }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var deudores = [], si = [], no = [];
    Array.prototype.forEach.call(cont.querySelectorAll('.deudor'), function (fila) {
      var nombre = fila.querySelector('.d-nombre').value.trim();
      if (!nombre) return;
      deudores.push({ nombre: nombre, rol: fila.querySelector('.d-rol').value });
      (fila.querySelector('.d-contesto').checked ? si : no).push(nombre);
    });
    var datos = {
      action: 'guia-audiencia-docx', causa: ini.causa,
      abogada: val('abogada'), trato: val('trato'), juezNombre: val('juezNombre'),
      audienciaFecha: val('audienciaFecha'), audienciaHora: val('audienciaHora'), audienciaSala: val('audienciaSala'),
      deudores: deudores, contestaron: si, noComparecieron: si.length ? no : [],
      numeroPagare: val('numeroPagare'), numeroEndoso: val('numeroEndoso'), fechaSuscripcion: val('fechaSuscripcion'),
      montoPagare: val('montoPagare'), tasa: val('tasa'), tipoCredito: val('tipoCredito'),
      plazo: val('plazo'), unidadPlazo: val('unidadPlazo'), dividendosPagados: val('dividendosPagados'),
      dividendoMora: val('dividendoMora'), fechaMora: val('fechaMora'), saldoCapital: val('saldoCapital'),
      fechaPresentacionDemanda: val('fechaPresentacionDemanda'),
      seguroDesgravamen: val('seguroDesgravamen'), reconoceDeuda: val('reconoceDeuda'),
      modulos: { legitimacion: val('m_legitimacion'), requisitos: val('m_requisitos'), falsedad: val('m_falsedad'), prescripcion: val('m_prescripcion'), diferimiento: val('m_diferimiento') },
      entidadOriginal: val('entidadOriginal'), fechaEndoso: val('fechaEndoso'),
      requisitoFechaLugar: val('requisitoFechaLugar'), requisitoLugarPago: val('requisitoLugarPago'),
      oposicion: { pericia: val('op_pericia'), testigos: val('op_testigos'), declaracionGerente: val('op_declaracionGerente'), oficios: val('op_oficios') },
      fechaUltimoPago: val('fechaUltimoPago'), dividendoUltimoPago: val('dividendoUltimoPago'), fechaCitacion: val('fechaCitacion'),
      fechaDiferimiento: val('fechaDiferimiento'),
      ia: aportesIA()
    };
    var btn = document.getElementById('generar');
    btn.disabled = true; btn.textContent = 'Generando…';
    fetch('/?action=guia-audiencia-docx&format=json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(datos)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || !x.j || !x.j.ok) throw new Error((x.j && x.j.error) || 'No se pudo generar la guía.');
        var bin = atob(x.j.archivo), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = x.j.nombre; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        var html = '<strong>✅ Guía descargada:</strong> ' + esc(x.j.nombre) + '.';
        if (x.j.faltantes) html += '<p class="pista">Quedaron ' + x.j.faltantes + ' dato(s) por completar, resaltados en amarillo en el Word.</p>';
        if (x.j.avisos && x.j.avisos.length) html += '<p style="margin:.6rem 0 0"><strong>⚠️ Revisar antes de la audiencia:</strong></p><ul>' + x.j.avisos.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
        mostrar(html, x.j.avisos && x.j.avisos.length ? 'aviso' : 'detectado');
        res.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function (e) { mostrar('❌ ' + esc(e.message || e), 'aviso'); })
      .finally(function () { btn.disabled = false; btn.textContent = 'Generar guía en Word'; });
  });
})();
</script>
</body>
</html>`;
}
