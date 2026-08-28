import type { ClasificacionEtapa, AnalisisCicloVidaMedida } from "./legal-analysis.js";

export function generarDashboardHTML(datos: any, esLote: boolean = false, resultadosLote: any[] = []): string {
  const causa = datos?.causa || "";
  const resumenIA = datos?.resumen_ejecutivo_ia || "No se ha realizado análisis aún.";
  const total = datos?.total_actuaciones || 0;
  const medidasCount = datos?.resumen_indicadores?.medidas_cautelares_count || 0;
  const resolucionesCount = datos?.resumen_indicadores?.resoluciones_count || 0;
  const actuaciones = datos?.actuaciones_recientes || [];
  const vectorDbStatus = datos?.vector_db_status || { activo: false, precedentes: [] };

  const poseeSentencia = datos?.analisis_dashboard?.posee_sentencia ?? false;
  const fechaSentencia = datos?.analisis_dashboard?.fecha_sentencia || null;

  const etapa: ClasificacionEtapa = datos?.clasificacion_etapa || {
    etapaGeneral: "SIN INFO",
    etapaEspecifica: "SIN INFO",
    codigoEtapa: "00",
    explicacion: "Sin datos"
  };

  const cautelar: AnalisisCicloVidaMedida = datos?.ciclo_vida_medida || {
    medidaDetectada: false,
    tipoMedida: "MEDIDA CAUTELAR",
    institucionEjecutora: "REGISTRO DE LA PROPIEDAD / MERCANTIL",
    estadoCicloVida: "INSCRIPCION_NO_CONFIRMADA",
    fechaOrdenJudicial: null,
    fechaOficio: null,
    fechaInscripcion: null,
    fechaActuacionSatje: null,
    fechaLevantamiento: null,
    numeroInscripcion: null,
    numeroRepertorio: null,
    confianza: "BAJA",
    evidenciaTextual: "Sin registro",
    observacion: "Sin datos",
    recomendacionEstrategica: "Sin datos",
    fuente: { tipoActuacion: "N/A" }
  };

  const estadoBadgeClass: Record<string, string> = {
    INSCRIPCION_CONFIRMADA: "danger",
    ORDENADA: "warning",
    OFICIADA: "warning",
    INSCRIPCION_NO_CONFIRMADA: "warning",
    LEVANTADA: "success"
  };

  const estadoTextos: Record<string, string> = {
    INSCRIPCION_CONFIRMADA: "🚨 CONFIRMADA",
    ORDENADA: "⚠️ ORDENADA",
    OFICIADA: "📨 OFICIADA",
    INSCRIPCION_NO_CONFIRMADA: "⚠️ NO CONFIRMADA",
    LEVANTADA: "🟢 LEVANTADA"
  };

  const abandono = datos?.alerta_abandono || {
    etiqueta: '🟢 Vigilancia / Normal',
    badgeClass: 'success',
    diasRestantes: 180,
    porcentajeGauge: 100,
    fechaUltimaActuacion: 'N/A',
    fechaReferencialAbandono: 'N/A',
    explicacion: 'Sin análisis',
    esDeprecatorio: false
  };

  const resumenHTML = resumenIA
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Agente SATJE Ecuador — Executive Legal Dashboard Pro</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    // FUNCIÓN GLOBAL DE CAMBIO DE PESTAÑAS (INSTANTÁNEA EN HEAD)
    window.selectTab = function(tabName) {
      var TABS = [
        { key: 'individual', contentId: 'tab-individual', btnId: 'tabBtnIndividual' },
        { key: 'lote', contentId: 'tab-lote', btnId: 'tabBtnLote' },
        { key: 'supervisor', contentId: 'tab-supervisor', btnId: 'tabBtnSupervisor' },
      ];
      TABS.forEach(function(t) {
        var content = document.getElementById(t.contentId);
        var btn = document.getElementById(t.btnId);
        var isActive = t.key === tabName;
        if (content) content.style.cssText = isActive ? 'display: block !important;' : 'display: none !important;';
        if (btn) { if (isActive) btn.classList.add('active'); else btn.classList.remove('active'); }
      });
    };

    // FUNCIONES DEL WIDGET DE CHAT FLOTANTE (WINDOW SCOPE - COMPUTED STYLE CHECK)
    window.toggleChat = function() {
      var panel = document.getElementById('chatWidget');
      if (panel) {
        var currentDisplay = window.getComputedStyle(panel).display;
        if (currentDisplay === 'flex') {
          panel.style.setProperty('display', 'none', 'important');
        } else {
          panel.style.setProperty('display', 'flex', 'important');
          var input = document.getElementById('chatInputText');
          if (input) input.focus();
        }
      }
    };

    window.usarPromptChip = function(texto) {
      var input = document.getElementById('chatInputText');
      if (input) {
        input.value = texto;
        if (document.getElementById('chatWidget') && document.getElementById('chatWidget').style.display !== 'flex') {
          window.toggleChat();
        }
        var form = document.querySelector('.chat-input-form');
        if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    };

    window.enviarMensajeChat = function(e) {
      if (e) e.preventDefault();
      var input = document.getElementById('chatInputText');
      var msgs = document.getElementById('chatMessages');
      if (!input || !input.value.trim() || !msgs) return;

      var promptTexto = input.value.trim();
      input.value = '';

      var userBubble = document.createElement('div');
      userBubble.className = 'chat-msg user';
      userBubble.innerText = promptTexto;
      msgs.appendChild(userBubble);
      msgs.scrollTop = msgs.scrollHeight;

      var aiBubble = document.createElement('div');
      aiBubble.className = 'chat-msg ai';
      aiBubble.innerHTML = "⏳ <em>El Asistente Legal está analizando el expediente...</em>";
      msgs.appendChild(aiBubble);
      msgs.scrollTop = msgs.scrollHeight;

      var causaActualUrl = new URLSearchParams(window.location.search).get('causa') || "${causa}";

      fetch('/?action=chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          prompt: promptTexto,
          causa: causaActualUrl
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.ok && res.respuesta) {
          var formatted = res.respuesta
            .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
            .replace(/\\n\\n/g, '<br/><br/>')
            .replace(/\\n/g, '<br/>');
          aiBubble.innerHTML = formatted;
        } else {
          aiBubble.innerHTML = "⚠️ No se pudo obtener respuesta del modelo. Revisa la clave OpenAI.";
        }
        msgs.scrollTop = msgs.scrollHeight;
      })
      .catch(function(err) {
        aiBubble.innerHTML = "⚠️ Error de conexión con el Asistente de IA: " + err.message;
        msgs.scrollTop = msgs.scrollHeight;
      });
    };

    // BUSCAR POSIBLE REINICIO TRAS ABANDONO PROCESAL (busca por cedula y
    // compara el asunto de la caratula contra las causas nuevas encontradas)
    window.buscarReinicioAbandono = function() {
      var input = document.getElementById('reinicioCedulaInput');
      var out = document.getElementById('reinicioResultados');
      if (!input || !out) return;
      var cedula = input.value.trim();
      if (!cedula) {
        out.innerHTML = '<span style="color:var(--warning);">Ingresa una cédula.</span>';
        return;
      }

      var causaActualUrl = new URLSearchParams(window.location.search).get('causa') || "${causa}";
      out.innerHTML = '⏳ Buscando causas con esa cédula y comparando el asunto...';

      fetch('/?action=buscar-reinicio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'buscar-reinicio', causaActual: causaActualUrl, cedula: cedula })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) {
          out.innerHTML = '⚠️ ' + (res.error || 'No se pudo completar la búsqueda.');
          return;
        }
        if (!res.candidatos || res.candidatos.length === 0) {
          out.innerHTML = '<div style="color:var(--text-muted);">Asunto detectado: <strong>' + res.asuntoDetectado + '</strong>. No se encontraron causas nuevas con ese mismo asunto para esta cédula (de un total de ' + res.totalCausasCedula + ' causas revisadas).</div>';
          return;
        }
        var html = '<div style="color:#e2e8f0; margin-bottom:0.5rem;">Asunto detectado: <strong>' + res.asuntoDetectado + '</strong>. ' + res.candidatos.length + ' causa(s) candidata(s):</div>';
        res.candidatos.forEach(function(c) {
          html += '<div style="padding:0.5rem 0.7rem; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:0.4rem; margin-bottom:0.4rem;">' +
            '<a href="/?causa=' + encodeURIComponent(c.numeroProceso) + '" style="color:var(--accent); font-weight:800; text-decoration:none;">' + c.numeroProceso + '</a>' +
            '<div style="font-size:0.82rem; color:var(--text-muted);">📅 Ingreso: ' + (c.fechaIngreso || 'N/A') + ' · 🏛️ ' + (c.judicatura || 'N/A') + '</div>' +
            '</div>';
        });
        out.innerHTML = html;
      })
      .catch(function(err) {
        out.innerHTML = '⚠️ Error de conexión: ' + err.message;
      });
    };

    // LOTE SUPERVISOR: busca por cedula (no por numero de causa), determina
    // el ultimo juicio vigente por persona y arma la tabla para exportar.
    function parsearFilasSupervisor(texto) {
      return texto
        .split(/\\r?\\n/)
        .map(function(linea) { return linea.trim(); })
        .filter(Boolean)
        .map(function(linea) {
          var partes = linea.indexOf('\\t') !== -1 ? linea.split('\\t') : linea.split(',');
          partes = partes.map(function(p) { return p.trim(); });
          return {
            cedula: partes[0] || '',
            nombres: partes[1] || '',
            apellidos: partes[2] || '',
            numeroOperacion: partes[3] || '',
          };
        });
    }

    window.ejecutarLoteSupervisor = function() {
      var input = document.getElementById('inputSupervisorLote');
      var box = document.getElementById('supervisorResultadosBox');
      if (!input || !box) return;

      var personas = parsearFilasSupervisor(input.value);
      if (personas.length === 0) {
        box.innerHTML = '<div class="card" style="padding:1.5rem; color:var(--warning);">Pega al menos una fila con cédula.</div>';
        return;
      }

      box.innerHTML = '<div class="card" style="padding:1.5rem; text-align:center; color:var(--text-muted);">⏳ Consultando ' + personas.length + ' cédula(s) en SATJE, esto puede tardar...</div>';

      fetch('/?action=lote-supervisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lote-supervisor', personas: personas })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok) {
          box.innerHTML = '<div class="card" style="padding:1.5rem; color:var(--danger);">⚠️ ' + (res.error || 'No se pudo completar la consulta.') + '</div>';
          return;
        }
        var filas = res.filas || [];
        var html = '<div class="batch-card">' +
          '<div class="batch-header">' +
            '<div class="batch-title">🗂️ RESULTADO LOTE SUPERVISOR (' + filas.length + ' persona(s))</div>' +
            '<button class="btn-copy" onclick="exportarCSVTabla(\\'supervisorTable\\', \\'Lote_Supervisor_SATJE.csv\\')">📥 Exportar a CSV / Excel</button>' +
          '</div>' +
          '<div class="table-container"><table class="batch-table" id="supervisorTable"><thead><tr>' +
            '<th>Cédula</th><th>Nombres</th><th>Apellidos</th><th>N° Operación</th>' +
            '<th>N° Proceso Vigente</th><th>Etapa Procesal General</th><th>Etapa Procesal</th>' +
            '<th>F. Inscripción Medida Cautelar</th><th>Unidad Judicial Deprecada Deudor</th>' +
            '<th>Fecha Calificación Deprecatorio DEU</th><th>Unidad Judicial Deprecada Garante</th>' +
            '<th>Fecha Calificación Deprecatorio GAR</th><th>Fecha de Etapa</th><th>Acción</th>' +
          '</tr></thead><tbody>';

        filas.forEach(function(f) {
          if (f.error) {
            html += '<tr><td>' + f.cedula + '</td><td>' + f.nombres + '</td><td>' + f.apellidos + '</td><td>' + f.numeroOperacion + '</td>' +
              '<td colspan="10" style="color:var(--danger);">⚠️ ' + f.error + '</td></tr>';
            return;
          }
          if (f.sinCausaVigente) {
            html += '<tr><td>' + f.cedula + '</td><td>' + f.nombres + '</td><td>' + f.apellidos + '</td><td>' + f.numeroOperacion + '</td>' +
              '<td colspan="10" style="color:var(--text-muted);">Sin juicio vigente (' + (f.totalCausasEncontradas || 0) + ' causa(s) encontradas, todas cerradas/abandonadas o ninguna causa)</td></tr>';
            return;
          }
          html += '<tr>' +
            '<td>' + f.cedula + '</td><td>' + f.nombres + '</td><td>' + f.apellidos + '</td><td>' + f.numeroOperacion + '</td>' +
            '<td><strong>' + (f.numeroProceso || '') + '</strong></td>' +
            '<td>' + (f.etapaProcesalGeneral || 'No disponible') + '</td>' +
            '<td style="font-size:0.85rem;">' + (f.etapaProcesalEspecifica || 'No disponible') + '</td>' +
            '<td>' + (f.fechaInscripcionMedidaCautelar || 'No confirmada') + '</td>' +
            '<td>' + (f.unidadJudicialDeprecadaDeudor || 'No disponible') + '</td>' +
            '<td>' + (f.fechaCalificacionDeprecatorioDeu || 'No disponible') + '</td>' +
            '<td>' + (f.unidadJudicialDeprecadaGarante || 'No disponible') + '</td>' +
            '<td>' + (f.fechaCalificacionDeprecatorioGar || 'No disponible') + '</td>' +
            '<td>' + (f.fechaDeEtapa || 'No disponible') + '</td>' +
            '<td><a href="/?causa=' + encodeURIComponent(f.numeroProceso || '') + '" class="chip-btn chip-link" style="font-size:0.75rem;">Ver Detalle ➔</a></td>' +
          '</tr>';
        });

        html += '</tbody></table></div></div>';
        box.innerHTML = html;
      })
      .catch(function(err) {
        box.innerHTML = '<div class="card" style="padding:1.5rem; color:var(--danger);">⚠️ Error de conexión: ' + err.message + '</div>';
      });
    };

    window.exportarCSVTabla = function(tableId, nombreArchivo) {
      var table = document.getElementById(tableId);
      if (!table) return;
      var csv = [];
      for (var i = 0; i < table.rows.length; i++) {
        var row = [], cols = table.rows[i].querySelectorAll('td, th');
        for (var j = 0; j < cols.length - 1; j++) {
          row.push('"' + cols[j].innerText.replace(/"/g, '""') + '"');
        }
        csv.push(row.join(','));
      }
      var csvFile = new Blob([csv.join('\\n')], { type: 'text/csv;charset=utf-8;' });
      var downloadLink = document.createElement('a');
      downloadLink.download = nombreArchivo || 'export.csv';
      downloadLink.href = window.URL.createObjectURL(csvFile);
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      downloadLink.click();
    };

    // VERIFICACIÓN DE SESIÓN Y AUTENTICACIÓN
    window.togglePasswordVisibility = function(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var input = document.getElementById('loginPasswordInput');
      var btn = document.getElementById('btnToggleEyePass');
      if (!input) return false;
      if (input.type === 'password') {
        input.type = 'text';
        if (btn) btn.innerHTML = '🙈';
      } else {
        input.type = 'password';
        if (btn) btn.innerHTML = '👁️';
      }
      return false;
    };

    window.verificarSesionAuth = function() {
      var mainContainer = document.getElementById('mainContentContainer');
      var btnChat = document.getElementById('btnToggleChat');

      if (mainContainer) mainContainer.style.cssText = 'display: block !important;';
      if (btnChat) btnChat.style.cssText = 'display: flex !important;';
    };

    window.procesarLogin = function(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      try {
        sessionStorage.setItem('satje_auth_token', 'authenticated');
        localStorage.setItem('satje_auth_token', 'authenticated');
      } catch(eAuth) {}

      var modal = document.getElementById('loginModal');
      var main = document.getElementById('mainContentContainer');
      var btnLogout = document.getElementById('btnLogoutNavbar');
      var btnChat = document.getElementById('btnToggleChat');

      if (modal) modal.style.cssText = 'display: none !important;';
      if (main) main.style.cssText = 'display: block !important;';
      if (btnLogout) btnLogout.style.cssText = 'display: flex !important;';
      if (btnChat) btnChat.style.cssText = 'display: flex !important;';

      return false;
    };

    window.cerrarSesion = function() {
      sessionStorage.removeItem('satje_auth_token');
      localStorage.removeItem('satje_auth_token');
      window.verificarSesionAuth();
    };

    // MOTOR DE NAVEGACIÓN CLIENTE-SIDE (SPA / FETCH SIN REFRESH DE PÁGINA)
    var animTimer = null;
    window.activarModalCarga = function(mensajeText) {
      var card = document.getElementById('loadingOverlay');
      var step = document.getElementById('loadingStep');
      if (card) {
        card.style.display = 'block';
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (step && mensajeText) step.innerText = mensajeText;

      var pasos = [
        "🔍 Conectando con los servidores del SATJE en vivo...",
        "📥 Extrayendo actuaciones judiciales e incidentes...",
        "⚖️ Verificando estado de Sentencia y Resoluciones...",
        "📌 Clasificando Etapa Procesal General y Específica...",
        "📌 Analizando Ciclo de Vida de Medidas Cautelares (4 Fechas)...",
        "⏱️ Calculando Alerta Preventiva de Abandono (Art. 245 COGEP)...",
        "⚡ Sincronizando con Upstash Vector DB...",
        "🤖 Sintetizando informe de Inteligencia Artificial..."
      ];

      var idx = 0;
      if (animTimer) clearInterval(animTimer);
      animTimer = setInterval(function() {
        idx = (idx + 1) % pasos.length;
        if (step) {
          step.style.opacity = '0.3';
          setTimeout(function() {
            step.innerText = pasos[idx];
            step.style.opacity = '1';
          }, 150);
        }
      }, 1400);
    };

    window.ejecutarConsultaClientSide = function(urlDestino, msgInicial) {
      window.activarModalCarga(msgInicial || "🔍 Consultando expediente judicial...");
      
      fetch(urlDestino)
        .then(function(res) { return res.text(); })
        .then(function(htmlText) {
          var parser = new DOMParser();
          var doc = parser.parseFromString(htmlText, 'text/html');
          
          history.pushState(null, '', urlDestino);

          var containerActual = document.querySelector('.container');
          var containerNuevo = doc.querySelector('.container');
          if (containerActual && containerNuevo) {
            containerActual.innerHTML = containerNuevo.innerHTML;
          }
          
          window.scrollTo({ top: 0, behavior: 'smooth' });
          window.inicializarEventosFormularios();
          window.verificarSesionAuth();
        })
        .catch(function(err) {
          console.error("Error al cargar consulta:", err);
          window.location.href = urlDestino;
        });
    };
  </script>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(30, 41, 59, 0.7);
      --card-inner: rgba(15, 23, 42, 0.85);
      --accent: #38bdf8;
      --accent-gradient: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
      --accent-hover: #0284c7;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: rgba(51, 65, 85, 0.8);
      --danger: #f43f5e;
      --warning: #fbbf24;
      --success: #10b981;
      --purple: #c084fc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding: 0; min-height: 100vh; background-image: radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.08) 0%, transparent 60%); }
    
    .navbar { background: rgba(11, 15, 25, 0.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border); padding: 1rem 2rem; position: sticky; top: 0; z-index: 100; display: flex; justify-content: space-between; align-items: center; }
    .brand { display: flex; align-items: center; gap: 0.75rem; font-weight: 800; font-size: 1.25rem; color: #fff; text-decoration: none; }
    .brand-logo { width: 34px; height: 34px; background: var(--accent-gradient); border-radius: 0.6rem; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; box-shadow: 0 0 15px rgba(56, 189, 248, 0.4); }
    .nav-actions { display: flex; align-items: center; gap: 1rem; }
    .status-pill { font-size: 0.8rem; font-weight: 600; color: var(--success); background: rgba(16, 185, 129, 0.12); padding: 0.35rem 0.8rem; border-radius: 2rem; border: 1px solid rgba(16, 185, 129, 0.3); display: flex; align-items: center; gap: 0.4rem; }
    .status-dot { width: 7px; height: 7px; background: var(--success); border-radius: 50%; box-shadow: 0 0 8px var(--success); }

    /* ESTILOS DEL MODAL DE LOGIN */
    .login-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(11, 15, 25, 0.96); backdrop-filter: blur(24px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
    .login-card { background: rgba(30, 41, 59, 0.85); border: 1px solid var(--border); border-radius: 1.5rem; padding: 2.8rem 2.2rem; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); }
    .login-logo { width: 64px; height: 64px; background: var(--accent-gradient); border-radius: 1.2rem; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 1.2rem auto; box-shadow: 0 0 25px rgba(56, 189, 248, 0.4); }
    .login-title { font-size: 1.6rem; font-weight: 800; color: #fff; margin-bottom: 0.4rem; }
    .login-subtitle { font-size: 0.92rem; color: var(--text-muted); margin-bottom: 1.8rem; }

    /* ESTILOS DEL WIDGET DE CHAT FLOTANTE */
    .chat-fab { position: fixed; bottom: 1.8rem; right: 1.8rem; z-index: 1000; background: var(--accent-gradient); color: #0f172a; border: none; border-radius: 2rem; padding: 0.9rem 1.6rem; font-weight: 800; font-size: 1rem; cursor: pointer; display: flex; align-items: center; gap: 0.6rem; box-shadow: 0 8px 25px rgba(56, 189, 248, 0.45); transition: transform 0.2s; }
    .chat-fab:hover { transform: scale(1.05); }
    
    .chat-panel { position: fixed; bottom: 5.5rem; right: 1.8rem; z-index: 1000; width: 400px; max-width: calc(100vw - 2.5rem); height: 550px; max-height: calc(100vh - 7rem); background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 1.2rem; box-shadow: 0 20px 50px rgba(0,0,0,0.6); display: none; flex-direction: column; overflow: hidden; }
    .chat-header { background: rgba(30, 41, 59, 0.8); border-bottom: 1px solid var(--border); padding: 1rem 1.2rem; display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: #fff; }
    .chat-close-btn { background: none; border: none; color: var(--text-muted); font-size: 1.2rem; cursor: pointer; }
    .chat-close-btn:hover { color: #fff; }
    
    .chat-body { flex: 1; padding: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.8rem; font-size: 0.92rem; }
    .chat-msg { padding: 0.8rem 1rem; border-radius: 0.8rem; max-width: 85%; line-height: 1.5; }
    .chat-msg.user { background: var(--accent); color: #0f172a; align-self: flex-end; font-weight: 600; border-bottom-right-radius: 0.2rem; }
    .chat-msg.ai { background: var(--card-inner); border: 1px solid var(--border); color: #f1f5f9; align-self: flex-start; border-bottom-left-radius: 0.2rem; }
    .chat-msg.ai strong { color: var(--accent); }

    .chat-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; padding: 0.6rem 1rem; background: rgba(11, 15, 25, 0.6); border-top: 1px solid var(--border); }
    .chat-chip { font-size: 0.75rem; background: rgba(56, 189, 248, 0.12); color: var(--accent); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.3rem 0.6rem; border-radius: 0.5rem; cursor: pointer; font-weight: 600; }
    .chat-chip:hover { background: var(--accent); color: #0f172a; }

    .chat-footer { padding: 0.8rem 1rem; border-top: 1px solid var(--border); background: rgba(15, 23, 42, 0.9); }
    .chat-input-form { display: flex; gap: 0.5rem; }
    .chat-input { flex: 1; background: #060911; border: 1px solid var(--border); border-radius: 0.6rem; padding: 0.6rem 0.9rem; color: #fff; outline: none; font-size: 0.9rem; }
    .chat-send-btn { background: var(--accent-gradient); color: #0f172a; border: none; border-radius: 0.6rem; padding: 0.6rem 1rem; font-weight: 800; cursor: pointer; }

    .container { max-width: 1250px; margin: 2rem auto; padding: 0 1.5rem; }
    .hero { text-align: center; margin-bottom: 1.8rem; }
    .hero h1 { font-size: 2.5rem; font-weight: 800; background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.4rem; letter-spacing: -0.02em; }
    .hero p { color: var(--text-muted); font-size: 1.05rem; }

    .tabs-nav { display: flex; gap: 0.8rem; margin-bottom: 1.5rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; justify-content: center; }
    .tab-btn { background: rgba(30, 41, 59, 0.6); color: var(--text-muted); border: 1px solid var(--border); padding: 0.85rem 2rem; border-radius: 0.8rem 0.8rem 0 0; font-size: 1.02rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 0.5rem; }
    .tab-btn:hover { background: rgba(56, 189, 248, 0.15); color: var(--accent); }
    .tab-btn.active { background: var(--accent-gradient); color: #0f172a; border-color: var(--accent); box-shadow: 0 -4px 15px rgba(56, 189, 248, 0.35); }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .loading-card { background: rgba(15, 23, 42, 0.96); backdrop-filter: blur(20px); border: 2px solid var(--accent); padding: 2.5rem 2rem; border-radius: 1.2rem; text-align: center; margin-bottom: 2rem; box-shadow: 0 0 40px rgba(56, 189, 248, 0.35); display: none; }
    .robot-icon { font-size: 3.8rem; margin-bottom: 1rem; animation: pulseBounce 1.2s infinite alternate; }
    @keyframes pulseBounce { 0% { transform: translateY(0) scale(1); } 100% { transform: translateY(-14px) scale(1.1); } }
    .loading-title { font-size: 1.4rem; font-weight: 800; color: #fff; margin-bottom: 0.6rem; }
    .loading-step { font-size: 1.05rem; color: var(--accent); font-weight: 700; margin-bottom: 1.4rem; min-height: 1.6rem; transition: opacity 0.2s; }
    .progress-bar { width: 100%; height: 10px; background: #060911; border-radius: 6px; overflow: hidden; position: relative; border: 1px solid var(--border); }
    .progress-fill { height: 100%; width: 45%; background: var(--accent-gradient); border-radius: 6px; position: absolute; animation: progressAnim 1.6s infinite ease-in-out; }
    @keyframes progressAnim { 0% { left: -45%; width: 45%; } 50% { left: 25%; width: 65%; } 100% { left: 100%; width: 45%; } }

    .search-box { background: var(--card-bg); backdrop-filter: blur(12px); padding: 1.5rem; border-radius: 1.2rem; border: 1px solid var(--border); margin-bottom: 2rem; box-shadow: 0 20px 40px -15px rgba(0,0,0,0.6); }
    .search-form { display: flex; gap: 0.75rem; }
    .search-form.vertical { display: flex; flex-direction: column; }
    .search-input { flex: 1; padding: 1rem 1.4rem; background: #060911; border: 1px solid var(--border); border-radius: 0.8rem; color: #fff; font-size: 1.05rem; outline: none; transition: all 0.2s; font-weight: 500; }
    .search-input:focus { border-color: var(--accent); box-shadow: 0 0 20px rgba(56, 189, 248, 0.25); }
    .btn-search { padding: 1rem 2.2rem; background: var(--accent-gradient); color: #0f172a; font-weight: 800; font-size: 1.02rem; border: none; border-radius: 0.8rem; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; box-shadow: 0 4px 15px rgba(56, 189, 248, 0.3); }
    .btn-search:hover { transform: translateY(-2px); box-shadow: 0 6px 22px rgba(56, 189, 248, 0.45); }

    .quick-chips { display: flex; gap: 0.6rem; align-items: center; margin-top: 1rem; flex-wrap: wrap; }
    .chip-label { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; }
    .chip-btn { background: rgba(15, 23, 42, 0.8); color: var(--accent); border: 1px solid var(--border); padding: 0.35rem 0.8rem; border-radius: 0.5rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: all 0.2s; }
    .chip-btn:hover { background: var(--accent); color: #0f172a; }

    .batch-card { background: var(--card-bg); backdrop-filter: blur(12px); padding: 2rem; border-radius: 1.2rem; border: 1px solid var(--border); margin-bottom: 2rem; }
    .batch-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
    .batch-title { font-size: 1.35rem; font-weight: 800; color: #fff; }

    .table-container { overflow-x: auto; }
    .batch-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.92rem; }
    .batch-table th { background: var(--card-inner); color: var(--text-muted); padding: 1rem 1.2rem; font-weight: 700; text-transform: uppercase; font-size: 0.78rem; border-bottom: 1px solid var(--border); letter-spacing: 0.05em; }
    .batch-table td { padding: 1.1rem 1.2rem; border-bottom: 1px solid var(--border); color: #e2e8f0; vertical-align: middle; }
    .batch-table tr:hover { background: rgba(56, 189, 248, 0.04); }

    .kpi-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 1.5rem; margin-bottom: 2rem; }
    @media (max-width: 900px) {
      .kpi-grid { grid-template-columns: 1fr; }
    }
    
    .kpi-card { background: var(--card-bg); backdrop-filter: blur(12px); padding: 1.8rem 2rem; border-radius: 1.2rem; border: 1px solid var(--border); position: relative; overflow: hidden; transition: transform 0.2s; display: flex; flex-direction: column; justify-content: space-between; }
    .kpi-card:hover { transform: translateY(-2px); }
    .kpi-card.sentencia-no { border-left: 6px solid var(--warning); }
    .kpi-card.sentencia-si { border-left: 6px solid var(--success); }
    .kpi-card.medida-vigente { border-left: 6px solid var(--danger); box-shadow: inset 0 0 30px rgba(244, 63, 94, 0.05); }
    .kpi-card.medida-ordenada { border-left: 6px solid var(--warning); }
    .kpi-card.medida-levantada { border-left: 6px solid var(--success); }
    .kpi-card.medida-normal { border-left: 6px solid var(--text-muted); }
    .kpi-card.etapa-card { border-left: 6px solid var(--accent); grid-column: 1 / -1; }
    .kpi-card.abandono-card { border-top: 5px solid var(--purple); grid-column: 1 / -1; }
    .kpi-card.vector-card { border-left: 6px solid #10b981; grid-column: 1 / -1; background: rgba(6, 78, 59, 0.2); }

    .kpi-tag { font-size: 0.78rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.4rem 0.8rem; border-radius: 0.5rem; display: inline-block; margin-bottom: 0.9rem; width: fit-content; }
    .kpi-tag.warning { background: rgba(251, 191, 36, 0.15); color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.3); }
    .kpi-tag.success { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
    .kpi-tag.danger { background: rgba(244, 63, 94, 0.15); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.3); }
    .kpi-tag.muted { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); border: 1px solid rgba(148, 163, 184, 0.3); }
    .kpi-tag.purple { background: rgba(192, 132, 252, 0.15); color: var(--purple); border: 1px solid rgba(192, 132, 252, 0.3); }
    .kpi-tag.accent { background: rgba(56, 189, 248, 0.15); color: var(--accent); border: 1px solid rgba(56, 189, 248, 0.3); }

    .kpi-main-title { font-size: 1.45rem; font-weight: 800; color: #fff; margin-bottom: 0.5rem; letter-spacing: -0.01em; }
    .kpi-subtext { font-size: 0.92rem; color: var(--text-muted); margin-top: 0.6rem; line-height: 1.6; }

    .stepper-container { display: flex; align-items: center; justify-content: space-between; margin: 1.2rem 0; background: var(--card-inner); padding: 1rem 1.4rem; border-radius: 0.8rem; border: 1px solid var(--border); position: relative; gap: 0.5rem; flex-wrap: wrap; }
    .step-item { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; flex: 1; min-width: 110px; text-align: center; }
    .step-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; font-weight: 800; background: #1e293b; color: var(--text-muted); border: 2px solid var(--border); }
    .step-item.active .step-icon { background: var(--accent-gradient); color: #0f172a; border-color: var(--accent); box-shadow: 0 0 12px rgba(56, 189, 248, 0.4); }
    .step-item.completed .step-icon { background: rgba(16, 185, 129, 0.2); color: var(--success); border-color: var(--success); }
    .step-lbl { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }

    .fechas-grid-cuatro { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-top: 1rem; background: var(--card-inner); padding: 1.1rem 1.3rem; border-radius: 0.8rem; border: 1px solid var(--border); }
    .fecha-item-title { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .fecha-item-val { font-size: 1.1rem; font-weight: 800; color: var(--accent); margin-top: 0.2rem; }

    .ocr-box { background: var(--card-inner); padding: 1.2rem 1.4rem; border-radius: 0.8rem; border-left: 4px solid var(--purple); font-size: 0.95rem; color: #f1f5f9; margin-top: 1rem; line-height: 1.7; border-top: 1px solid var(--border); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); word-break: break-word; }

    .advice-box { background: rgba(56, 189, 248, 0.08); border-left: 4px solid var(--accent); padding: 1rem 1.2rem; border-radius: 0.6rem; font-size: 0.92rem; color: #e2e8f0; margin-top: 1rem; border-top: 1px solid var(--border); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }

    .confianza-badge { font-size: 0.75rem; font-weight: 800; padding: 0.2rem 0.6rem; border-radius: 0.4rem; display: inline-block; }
    .confianza-ALTA { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    .confianza-MEDIA { background: rgba(251, 191, 36, 0.2); color: var(--warning); }
    .confianza-BAJA { background: rgba(244, 63, 94, 0.2); color: var(--danger); }

    .abandono-gauge-container { margin: 1.2rem 0 0.8rem 0; background: var(--card-inner); padding: 1.3rem; border-radius: 0.9rem; border: 1px solid var(--border); }
    .gauge-header { display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.5rem; }
    .gauge-track { width: 100%; height: 10px; background: #060911; border-radius: 10px; overflow: hidden; position: relative; }
    .gauge-bar { height: 100%; border-radius: 10px; transition: width 1s ease-in-out; }

    .abandono-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.2rem; margin-top: 1.2rem; background: var(--card-inner); padding: 1.3rem; border-radius: 0.9rem; border: 1px solid var(--border); }
    .abandono-item-title { font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .abandono-item-val { font-size: 1.25rem; font-weight: 800; color: #fff; margin-top: 0.25rem; }

    .disclaimer-box { font-size: 0.82rem; color: var(--text-muted); background: rgba(15, 23, 42, 0.7); padding: 0.9rem 1.2rem; border-radius: 0.6rem; border: 1px dashed var(--border); margin-top: 1.2rem; line-height: 1.5; }

    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1.2rem; margin-bottom: 2rem; }
    .stat-pill { background: var(--card-bg); backdrop-filter: blur(12px); padding: 1.4rem; border-radius: 1rem; border: 1px solid var(--border); text-align: center; }
    .stat-num { font-size: 2.2rem; font-weight: 800; color: var(--accent); }
    .stat-num.danger { color: var(--danger); }
    .stat-lbl { color: var(--text-muted); font-size: 0.82rem; font-weight: 700; text-transform: uppercase; margin-top: 0.3rem; letter-spacing: 0.05em; }

    .card { background: var(--card-bg); backdrop-filter: blur(12px); padding: 2rem; border-radius: 1.2rem; border: 1px solid var(--border); margin-bottom: 2rem; box-shadow: 0 10px 30px -10px rgba(0,0,0,0.3); }
    .card-title { font-size: 1.25rem; font-weight: 800; margin-bottom: 1.3rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.9rem; }
    
    .btn-copy { background: rgba(56, 189, 248, 0.15); color: var(--accent); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.45rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: all 0.2s; }
    .btn-copy:hover { background: var(--accent); color: #0f172a; }

    .ai-box { line-height: 1.8; color: #cbd5e1; font-size: 1.02rem; font-weight: 400; }
    .ai-box strong { color: var(--accent); font-weight: 700; }

    .timeline { display: flex; flex-direction: column; gap: 1.1rem; }
    .timeline-item { background: var(--card-inner); padding: 1.3rem 1.5rem; border-radius: 0.8rem; border-left: 4px solid var(--accent); border-top: 1px solid var(--border); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .timeline-header { display: flex; justify-content: space-between; font-size: 0.88rem; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600; }
    .timeline-title { font-weight: 600; color: #fff; font-size: 1rem; line-height: 1.6; }
    .badge { display: inline-block; padding: 0.3rem 0.7rem; border-radius: 0.5rem; font-size: 0.78rem; font-weight: 700; background: #1e293b; color: var(--accent); border: 1px solid var(--border); }

    .footer { text-align: center; color: var(--text-muted); font-size: 0.88rem; margin-top: 3.5rem; padding-bottom: 2rem; }
  </style>
</head>
<body>

  <!-- BARRA DE NAVEGACIÓN SUPERIOR -->
  <nav class="navbar">
    <a href="/" class="brand">
      <div class="brand-logo">⚖️</div>
      <span>Agente Judicial SATJE</span>
    </a>
    <div class="nav-actions">
      <div class="status-pill">
        <div class="status-dot"></div>
        <span>API SATJE En Vivo</span>
      </div>
    </div>
  </nav>

  <!-- CONTENIDO PRINCIPAL DEL DASHBOARD (DIRECTO Y ACCESIBLE) -->
  <div id="mainContentContainer" style="display:block;">
    <div class="container">
      <div class="hero">
        <h1>Dashboard Procesal de Inteligencia Judicial</h1>
        <p>Plataforma Executive para Análisis Individual y Consulta en Lote</p>
      </div>

      <!-- PESTAÑAS SUPERIORES DE NAVEGACIÓN (INDIVIDUAL VS LOTE) -->
      <div class="tabs-nav">
        <button id="tabBtnIndividual" class="tab-btn ${!esLote ? 'active' : ''}" type="button" onclick="window.selectTab('individual')">
          🔍 Consulta Individual de Proceso
        </button>
        <button id="tabBtnLote" class="tab-btn ${esLote ? 'active' : ''}" type="button" onclick="window.selectTab('lote')">
          📋 Consulta en Lote (Matriz Resumen)
        </button>
        <button id="tabBtnSupervisor" class="tab-btn" type="button" onclick="window.selectTab('supervisor')">
          🗂️ Lote Supervisor (por Cédula)
        </button>
      </div>

      <!-- TARJETA DE CARGA ESTÁTICA EN DOM -->
      <div id="loadingOverlay" class="loading-card">
        <div class="robot-icon">🤖</div>
        <div class="loading-title">El Agente de Inteligencia Judicial está procesando la solicitud...</div>
        <div class="loading-step" id="loadingStep">🔍 Conectando con los servidores del SATJE...</div>
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
      </div>

      <!-- PESTAÑA 1: CONSULTA INDIVIDUAL -->
      <div id="tab-individual" class="tab-content" style="display: ${!esLote ? 'block' : 'none'};">
        <div class="search-box">
          <form class="search-form" id="formSearchIndividual" method="GET" action="/" onsubmit="activarModalCarga('🔍 Consultando causa individual...');">
            <input type="text" name="causa" class="search-input" id="inputSearchIndividual" placeholder="Ingresa un número de causa (ej: 01333-2025-08870 o 01333-2023-10725)" value="${!esLote ? causa : ''}" required />
            <button type="submit" class="btn-search" id="btnSubmitIndividual">
              <span>Consultar Causa</span>
            </button>
          </form>
          <div class="quick-chips">
            <span class="chip-label">Ejemplos Rápidos:</span>
            <a href="/?causa=01333-2025-08870" class="chip-btn chip-link">01333-2025-08870 (Cuenca Civil)</a>
            <a href="/?causa=01333-2023-10725" class="chip-btn chip-link">01333-2023-10725 (Inmueble 2023)</a>
            <a href="/?causa=01333-2025-08348" class="chip-btn chip-link">01333-2025-08348 (Registral 2025)</a>
          </div>
        </div>

        ${causa && !esLote ? `
        <!-- RESULTADOS INDIVIDUALES -->
        <div class="kpi-grid">

          <!-- PANEL UPSTASH VECTOR DB & CACHÉ RAG -->
          <div class="kpi-card vector-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div class="kpi-tag success">⚡ UPSTASH VECTOR DB — RAG & PRECEDENTES</div>
              <span style="font-size:0.82rem; font-weight:800; color:var(--success);">
                ${vectorDbStatus.activo ? '🟢 RAG VECTORIAL CONECTADO' : '🟡 LISTO PARA CREDENCIALES'}
              </span>
            </div>

            <div class="kpi-main-title" style="font-size:1.35rem; color:#fff;">
              ${vectorDbStatus.activo ? 'Causa Indexada & Búsqueda Semántica de Precedentes Activa' : 'Motor de Búsqueda Vectorial Serverless (Upstash)'}
            </div>

            <p style="font-size:0.95rem; color:#e2e8f0; margin-top:0.4rem;">
              ${vectorDbStatus.activo 
                ? `Esta causa ha sido vectorizada e indexada en Upstash Vector DB. El Agente puede recuperar instantáneamente providencias clave o precedentes jurisprudenciales.` 
                : `Para activar la indexación en tiempo real y el motor RAG de precedentes, agrega <strong>UPSTASH_VECTOR_REST_URL</strong> y <strong>UPSTASH_VECTOR_REST_TOKEN</strong> en las variables de entorno de Vercel.`}
            </p>

            ${vectorDbStatus.precedentes && vectorDbStatus.precedentes.length > 0 ? `
              <div style="margin-top:1rem; background:rgba(15,23,42,0.8); padding:1rem; border-radius:0.7rem; border:1px solid var(--border);">
                <div style="font-size:0.85rem; font-weight:800; color:var(--success); margin-bottom:0.5rem;">🔍 Precedentes / Causas Semánticamente Similares Encontradas:</div>
                ${vectorDbStatus.precedentes.map((p: any) => `
                  <div style="font-size:0.88rem; color:#cbd5e1; margin-bottom:0.4rem;">
                    🔹 <strong>Causa ${p.metadata?.causa || p.id}:</strong> ${p.metadata?.etapa || 'Proceso'} (Similitud: ${Math.round((p.score || 0.9) * 100)}%)
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
          
          <!-- PANEL DE CLASIFICACIÓN DE ETAPA PROCESAL -->
          <div class="kpi-card etapa-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div class="kpi-tag accent">📌 CLASIFICACIÓN DE ETAPA PROCESAL</div>
              <span style="font-size:0.82rem; font-weight:800; color:var(--accent);">CÓDIGO: ${etapa.codigoEtapa}</span>
            </div>

            <div class="kpi-main-title" style="font-size:1.6rem; color:var(--accent);">
              ${etapa.etapaGeneral}
            </div>

            <div style="font-size:1.15rem; font-weight:800; color:#fff; margin-top:0.4rem;">
              🔹 Etapa Específica: <span style="color:#e2e8f0;">${etapa.etapaEspecifica}</span>
            </div>

            <p style="font-size:0.95rem; color:#cbd5e1; margin-top:0.6rem;">${etapa.explicacion}</p>
          </div>

          <!-- PANEL 1: ESTADO DE SENTENCIA -->
          <div class="kpi-card ${poseeSentencia ? 'sentencia-si' : 'sentencia-no'}">
            <div>
              <div class="kpi-tag ${poseeSentencia ? 'success' : 'warning'}">
                ${poseeSentencia ? '🟢 Sentencia Emitida' : '🔴 Sin Sentencia Emitida'}
              </div>
              <div class="kpi-main-title">
                ${poseeSentencia ? 'Sentencia Emitida en la Causa' : 'Sin Sentencia Dictada'}
              </div>
            </div>
            <div>
              ${poseeSentencia && fechaSentencia ? `
                <div class="kpi-date-badge">📅 Fecha Sentencia: ${fechaSentencia}</div>
              ` : `
                <div class="kpi-subtext">No se registra resolución final o sentencia ejecutoriada en este proceso hasta la fecha.</div>
              `}
            </div>
          </div>

          <!-- PANEL 2: MEDIDA CAUTELAR, STEPPER DE CICLO DE VIDA Y DETECTOR DE LAS 4 FECHAS -->
          <div class="kpi-card ${cautelar.medidaDetectada ? (cautelar.estadoCicloVida === 'INSCRIPCION_CONFIRMADA' ? 'medida-vigente' : (cautelar.estadoCicloVida === 'LEVANTADA' ? 'medida-levantada' : 'medida-ordenada')) : 'medida-normal'}">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="kpi-tag ${estadoBadgeClass[cautelar.estadoCicloVida] || 'muted'}">
                  ${estadoTextos[cautelar.estadoCicloVida] || '⚪ Sin Medida Cautelar'}
                </div>
                ${cautelar.medidaDetectada ? `<span class="confianza-badge confianza-${cautelar.confianza}">CONFIANZA ${cautelar.confianza}</span>` : ''}
              </div>

              <div class="kpi-main-title">
                ${cautelar.medidaDetectada ? cautelar.tipoMedida : 'Sin Registro de Medida Cautelar'}
              </div>

              ${cautelar.medidaDetectada ? `
                <div style="font-size:0.88rem; color:var(--text-muted); margin-bottom:0.5rem;">
                  🏛️ Institución Ejecutora: <strong>${cautelar.institucionEjecutora}</strong>
                </div>

                <!-- STEPPER DE CICLO DE VIDA -->
                <div class="stepper-container">
                  <div class="step-item ${cautelar.fechaOrdenJudicial ? 'completed' : ''}">
                    <div class="step-icon">1</div>
                    <div class="step-lbl">Ordenada</div>
                  </div>
                  <div class="step-item ${cautelar.fechaOficio ? 'completed' : (cautelar.estadoCicloVida === 'OFICIADA' ? 'active' : '')}">
                    <div class="step-icon">2</div>
                    <div class="step-lbl">Oficiada</div>
                  </div>
                  <div class="step-item ${cautelar.estadoCicloVida === 'INSCRIPCION_CONFIRMADA' ? 'active' : ''}">
                    <div class="step-icon">3</div>
                    <div class="step-lbl">Inscrita</div>
                  </div>
                  <div class="step-item ${cautelar.estadoCicloVida === 'LEVANTADA' ? 'completed' : ''}">
                    <div class="step-icon">4</div>
                    <div class="step-lbl">Levantada</div>
                  </div>
                </div>

                <!-- DESGLOSE EXPLICITO DE LAS 4 FECHAS PROCESALES -->
                <div class="fechas-grid-cuatro">
                  <div>
                    <div class="fecha-item-title">1. Orden Judicial (Juez)</div>
                    <div class="fecha-item-val">${cautelar.fechaOrdenJudicial || 'Pendiente'}</div>
                  </div>
                  <div>
                    <div class="fecha-item-title">2. Oficio Emitido</div>
                    <div class="fecha-item-val" style="color:var(--accent);">${cautelar.fechaOficio || 'Pendiente'}</div>
                  </div>
                  <div>
                    <div class="fecha-item-title">3. Inscripción Real Registral</div>
                    <div class="fecha-item-val" style="color:${cautelar.fechaInscripcion ? 'var(--danger)' : 'var(--text-muted)'};">${cautelar.fechaInscripcion || 'No confirmada'}</div>
                  </div>
                  <div>
                    <div class="fecha-item-title">4. Registro en SATJE</div>
                    <div class="fecha-item-val">${cautelar.fechaActuacionSatje || 'Pendiente'}</div>
                  </div>
                </div>

                <div class="ocr-box">
                  🔍 <strong>Evidencia y Razón Registral:</strong><br/>
                  ${cautelar.evidenciaTextual}
                  ${cautelar.numeroRepertorio ? `<br/><br/>📌 <strong>N° Repertorio / Registro:</strong> ${cautelar.numeroRepertorio}` : ''}
                  ${cautelar.fuente.archivo ? `<br/>📎 <strong>Documento Adjunto SATJE:</strong> ${cautelar.fuente.archivo}` : ''}
                </div>

                <div class="advice-box">
                  💡 <strong>Estrategia Legal Sugerida:</strong> ${cautelar.recomendacionEstrategica}
                </div>
              ` : `
                <div class="kpi-subtext">No se detectaron inscripciones de embargo, prohibición de enajenar o retención en las actuaciones ni adjuntos.</div>
              `}
            </div>
          </div>

          <!-- PANEL 3: ALERTA PREVENTIVA DE ABANDONO PROCESAL (COGEP ART. 245, 246, 247) -->
          <div class="kpi-card abandono-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div class="kpi-tag ${abandono.badgeClass}">
                ${abandono.etiqueta}
              </div>
              <span style="font-size:0.82rem; font-weight:700; color:var(--text-muted);">Sustento Legal: COGEP Art. 245 - 247</span>
            </div>

            <div class="kpi-main-title">
              ⏱️ Sistema de Alerta Preventiva de Abandono Procesal
            </div>

            <p style="font-size:0.98rem; color:#cbd5e1; margin-top:0.4rem;">${abandono.explicacion}</p>

            ${abandono.diasRestantes <= 180 && abandono.diasRestantes >= 0 ? `
            <div class="abandono-gauge-container">
              <div class="gauge-header">
                <span>HOLGURA PROCESAL (6 MESES)</span>
                <span>${abandono.diasRestantes} Días Restantes</span>
              </div>
              <div class="gauge-track">
                <div class="gauge-bar" style="width: ${abandono.porcentajeGauge}%; background: ${abandono.diasRestantes < 30 ? 'var(--danger)' : (abandono.diasRestantes < 60 ? 'var(--warning)' : 'var(--success)')};"></div>
              </div>
            </div>
            ` : ''}

            ${abandono.relojDeprecatorioInfo ? `
              <div style="font-size:0.88rem; color:var(--accent); font-weight:700; margin-top:0.6rem;">
                ${abandono.relojDeprecatorioInfo}
              </div>
            ` : ''}

            <div class="abandono-stats">
              <div>
                <div class="abandono-item-title">Última Actuación Útil</div>
                <div class="abandono-item-val">📅 ${abandono.fechaUltimaActuacion}</div>
              </div>
              <div>
                <div class="abandono-item-title">Límite Abandono (6 Meses)</div>
                <div class="abandono-item-val">📅 ${abandono.fechaReferencialAbandono}</div>
              </div>
              <div>
                <div class="abandono-item-title">Días Restantes Procesales</div>
                <div class="abandono-item-val" style="color: ${abandono.diasRestantes < 30 ? 'var(--danger)' : (abandono.diasRestantes < 60 ? 'var(--warning)' : 'var(--success)')}">
                  ${abandono.diasRestantes > 500 ? 'N/A' : (abandono.diasRestantes + ' Días')}
                </div>
              </div>
            </div>

            <div class="disclaimer-box">
              ⚠️ <strong>Disclaimer Jurídico Obligatorio:</strong> Indicador preventivo de posible inactividad procesal. No constituye una determinación jurídica ni reemplaza la revisión profesional del expediente.
            </div>

            ${abandono.nivel === 'abandonada' ? `
            <div style="margin-top:0.9rem; padding:0.9rem; background:rgba(15,23,42,0.6); border:1px solid var(--border); border-radius:0.6rem;">
              <div style="font-size:0.9rem; font-weight:800; color:#fff; margin-bottom:0.4rem;">🔎 ¿Se reinició con un número de proceso nuevo?</div>
              <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.6rem;">SATJE no vincula un proceso abandonado con la demanda nueva que lo reemplaza. Ingresa la cédula del actor o demandado para buscar posibles causas de reinicio (mismo asunto, fecha posterior al abandono).</p>
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                <input id="reinicioCedulaInput" type="text" placeholder="Cédula (ej. 0104270855)" style="flex:1; min-width:180px; padding:0.55rem 0.8rem; border-radius:0.5rem; border:1px solid var(--border); background:#0f172a; color:#fff; font-size:0.9rem;" />
                <button type="button" class="btn-copy" onclick="window.buscarReinicioAbandono()">Buscar reinicio</button>
              </div>
              <div id="reinicioResultados" style="margin-top:0.7rem; font-size:0.88rem;"></div>
            </div>
            ` : ''}
          </div>

        </div>

        <!-- MÉTRICAS DE CONTEO -->
        <div class="stats-row">
          <div class="stat-pill">
            <div class="stat-num">${total}</div>
            <div class="stat-lbl">Total Actuaciones</div>
          </div>
          <div class="stat-pill">
            <div class="stat-num danger">${medidasCount}</div>
            <div class="stat-lbl">Medidas Cautelares</div>
          </div>
          <div class="stat-pill">
            <div class="stat-num">${resolucionesCount}</div>
            <div class="stat-lbl">Resoluciones</div>
          </div>
        </div>

        <!-- INFORME DE INTELIGENCIA ARTIFICIAL CON BOTÓN DE COPIAR -->
        <div class="card">
          <div class="card-title">
            <span>🤖 Reporte Ejecutivo procesal de IA (OpenAI)</span>
            <button class="btn-copy" onclick="copiarResumenIA()">📋 Copiar Resumen</button>
          </div>
          <div class="ai-box" id="resumenIaText">${resumenHTML}</div>
        </div>

        <!-- LÍNEA DE TIEMPO PROCESAL -->
        ${actuaciones.length > 0 ? `
        <div class="card">
          <div class="card-title">📜 Cronología de Actuaciones e Incidentes (${actuaciones.length})</div>
          <div class="timeline">
            ${actuaciones.map((a: any) => `
              <div class="timeline-item">
                <div class="timeline-header">
                  <span>📅 ${a.fecha || a.fechaProvidencia || a.fechaActuacion || 'Sin fecha'}</span>
                  <span class="badge">${a.tipo || 'ACTUACIÓN'}</span>
                </div>
                <div class="timeline-title">${a.actividad || a.nombreActuacion || a.titulo || a.observacion || 'Actuación judicial'}</div>
                ${a.nombreJudicatura ? `<div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.4rem;">🏛️ Judicatura: ${a.nombreJudicatura}</div>` : ''}
                ${a.nombreArchivo ? `<div style="font-size:0.85rem; color:var(--accent); margin-top:0.4rem; font-weight:600;">📎 Documento Adjunto: ${a.nombreArchivo}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        ` : `
        <div class="card" style="text-align: center; padding: 4rem 2rem;">
          <p style="color: var(--text-muted); font-size: 1.1rem;">Ingresa un número de causa arriba para visualizar la inspección individual detallada.</p>
        </div>
        `}
      </div>

      <!-- PESTAÑA 2: CONSULTA EN LOTE (BATCH) -->
      <div id="tab-lote" class="tab-content" style="display: ${esLote ? 'block' : 'none'};">
        <div class="search-box">
          <form class="search-form vertical" id="formSearchLote" method="GET" action="/" onsubmit="activarModalCarga('📋 Procesando lote de causas...');">
            <label style="font-size:0.88rem; font-weight:700; color:var(--text-muted);">Ingresa la lista de causas (separadas por coma o salto de línea):</label>
            <textarea name="causas" class="search-input" id="inputSearchLote" rows="3" placeholder="Ej: 01333-2025-08870&#10;01333-2023-10725&#10;01333-2024-04697" required>${esLote ? causa : ''}</textarea>
            <button type="submit" class="btn-search" id="btnSubmitLote" style="align-self:flex-start; margin-top:0.8rem;">
              <span>📋 Ejecutar Consulta en Lote</span>
            </button>
          </form>
          <div class="quick-chips">
            <span class="chip-label">Consulta en Lote de Ejemplo:</span>
            <a href="/?causas=01333-2025-08870,01333-2023-10725,01333-2024-04697" class="chip-btn chip-link">📋 Probar Lote de 3 Causas</a>
          </div>
        </div>

        ${esLote ? `
        <!-- TABLA RESUMEN BATCH -->
        <div class="batch-card">
          <div class="batch-header">
            <div class="batch-title">📋 TABLA RESUMEN DE CONSULTA EN LOTE (${resultadosLote.length} Procesos)</div>
            <button class="btn-copy" onclick="exportarCSV()">📥 Exportar a CSV / Excel</button>
          </div>
          <div class="table-container">
            <table class="batch-table" id="batchTable">
              <thead>
                <tr>
                  <th># Causa / Proceso</th>
                  <th>Etapa Procesal General</th>
                  <th>Etapa Específica</th>
                  <th>Sentencia Emitida</th>
                  <th>Medida Cautelar (Ciclo Vida)</th>
                  <th>Fecha Inscripción</th>
                  <th>Alerta Abandono (COGEP)</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                ${resultadosLote.map((item: any) => `
                  <tr>
                    <td><strong>${item.causa}</strong></td>
                    <td><span class="kpi-tag accent">${item.etapaProcesalGeneral}</span></td>
                    <td style="font-size:0.85rem;">${item.etapaProcesalEspecifica}</td>
                    <td>${item.poseeSentencia ? '🟢 SÍ' : '🔴 NO'}</td>
                    <td><span class="kpi-tag ${estadoBadgeClass[item.estadoCicloVidaMedida] || 'muted'}">${estadoTextos[item.estadoCicloVidaMedida] || '⚪ Sin Medida'}</span></td>
                    <td style="font-weight:700; color:var(--accent);">${item.fechaInscripcionMedida || 'No confirmada'}</td>
                    <td><span class="kpi-tag ${item.alertaAbandonoObjeto.badgeClass}">${item.alertaAbandono}</span></td>
                    <td><a href="/?causa=${item.causa}" class="chip-btn chip-link" style="font-size:0.75rem;">Ver Detalle ➔</a></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : `
        <div class="card" style="text-align: center; padding: 4rem 2rem;">
          <p style="color: var(--text-muted); font-size: 1.1rem;">Ingresa la lista de causas arriba para generar la Matriz Resumen de Consulta en Lote.</p>
        </div>
        `}
      </div>

      <!-- PESTAÑA 3: LOTE SUPERVISOR (BÚSQUEDA POR CÉDULA) -->
      <div id="tab-supervisor" class="tab-content" style="display: none;">
        <div class="search-box">
          <label style="font-size:0.88rem; font-weight:700; color:var(--text-muted);">Pega las filas copiadas de Excel (cédula, nombres, apellidos, número de operación) — una persona por línea:</label>
          <textarea id="inputSupervisorLote" class="search-input" rows="6" placeholder="0104270855&#9;PEREZ&#9;JUAN&#9;OP-12345&#10;0912345678&#9;LOPEZ&#9;MARIA&#9;OP-67890" style="font-family: monospace; white-space: pre;"></textarea>
          <button type="button" class="btn-search" id="btnSubmitSupervisor" style="align-self:flex-start; margin-top:0.8rem;" onclick="window.ejecutarLoteSupervisor()">
            <span>🗂️ Ejecutar Consulta en Lote por Cédula</span>
          </button>
          <p style="font-size:0.82rem; color:var(--text-muted); margin-top:0.5rem;">Determina el <strong>último juicio vigente</strong> por persona (excluye causas ya sentenciadas o declaradas en abandono).</p>
        </div>

        <div id="supervisorResultadosBox"></div>
      </div>

      <div class="footer">
        Powered by Cloudflare / Vercel & OpenAI • Ecuador Judicial API Engine
      </div>
    </div>
  </div>

  <!-- WIDGET DE CHAT LEGAL DE INTELIGENCIA ARTIFICIAL (FLOTANTE) -->
  <button id="btnToggleChat" class="chat-fab" type="button" onclick="window.toggleChat(event)">
    <span class="fab-icon">💬</span> Chat Legal IA
  </button>

  <div id="chatWidget" class="chat-panel">
    <div class="chat-header">
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <span>🤖</span> Asistente Legal SATJE (RAG IA)
      </div>
      <button class="chat-close-btn" type="button" onclick="window.toggleChat(event)">✖</button>
    </div>
    
    <div class="chat-body" id="chatMessages">
      <div class="chat-msg ai">
        👋 ¡Hola! Soy tu <strong>Asistente Legal de Inteligencia Judicial</strong>.<br/><br/>
        Tengo acceso a las actuaciones reales de esta causa (${causa || 'General'}), sus 4 fechas registrales y la etapa procesal.<br/><br/>
        ¿En qué te puedo asesorar o qué escrito necesitas redactar?
      </div>
    </div>

    <div class="chat-chips">
      <button type="button" class="chat-chip" onclick="window.usarPromptChip('Redactar escrito de impulso procesal Art. 245 COGEP')">📝 Impulso Procesal</button>
      <button type="button" class="chat-chip" onclick="window.usarPromptChip('Analizar riesgo de embargo y fechas registrales')">⚖️ Riesgo Embargo</button>
      <button type="button" class="chat-chip" onclick="window.usarPromptChip('Generar resumen ejecutivo corto para cliente por WhatsApp')">📲 Resumen WhatsApp</button>
    </div>

    <div class="chat-footer">
      <form class="chat-input-form" onsubmit="window.enviarMensajeChat(event)">
        <input type="text" id="chatInputText" class="chat-input" placeholder="Pregunta sobre esta causa o pide redactar..." required />
        <button type="submit" class="chat-send-btn">Enviar</button>
      </form>
    </div>
  </div>

  <script>
    window.inicializarEventosFormularios = function() {
      var formIndiv = document.getElementById('formSearchIndividual');
      if (formIndiv) {
        formIndiv.addEventListener('submit', function(e) {
          e.preventDefault();
          var input = document.getElementById('inputSearchIndividual');
          if (input && input.value.trim()) {
            window.ejecutarConsultaClientSide("/?causa=" + encodeURIComponent(input.value.trim()), "🔍 Consultando causa individual: " + input.value.trim());
          }
        });
      }

      var formLote = document.getElementById('formSearchLote');
      if (formLote) {
        formLote.addEventListener('submit', function(e) {
          e.preventDefault();
          var input = document.getElementById('inputSearchLote');
          if (input && input.value.trim()) {
            var limpias = input.value.split(/[\\r\\n,;]+/).map(function(s){ return s.trim(); }).filter(Boolean).join(',');
            window.ejecutarConsultaClientSide("/?causas=" + encodeURIComponent(limpias), "📋 Procesando lote de causas en paralelo...");
          }
        });
      }

      document.querySelectorAll('.chip-link').forEach(function(link) {
        link.addEventListener('click', function(e) {
          e.preventDefault();
          var targetUrl = this.getAttribute('href');
          if (targetUrl) {
            window.ejecutarConsultaClientSide(targetUrl, "📥 Cargando expediente judicial...");
          }
        });
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        window.inicializarEventosFormularios();
        window.verificarSesionAuth();
      });
    } else {
      window.inicializarEventosFormularios();
      window.verificarSesionAuth();
    }

    function copiarResumenIA() {
      var text = document.getElementById('resumenIaText').innerText;
      navigator.clipboard.writeText(text).then(function() {
        alert('📋 ¡Resumen de IA copiado al portapapeles!');
      });
    }

    function exportarCSV() {
      var table = document.getElementById("batchTable");
      if (!table) return;
      var csv = [];
      for (var i = 0; i < table.rows.length; i++) {
        var row = [], cols = table.rows[i].querySelectorAll("td, th");
        for (var j = 0; j < cols.length - 1; j++) {
          row.push('"' + cols[j].innerText.replace(/"/g, '""') + '"');
        }
        csv.push(row.join(","));
      }
      var csvFile = new Blob([csv.join("\\n")], { type: "text/csv;charset=utf-8;" });
      var downloadLink = document.createElement("a");
      downloadLink.download = "Resumen_Batch_SATJE.csv";
      downloadLink.href = window.URL.createObjectURL(csvFile);
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);
      downloadLink.click();
    }
  </script>
</body>
</html>`;
}
