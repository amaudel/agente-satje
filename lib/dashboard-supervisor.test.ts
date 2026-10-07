import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { generarDashboardHTML } from "./dashboard-html.js";

// Ejecuta de verdad el JavaScript de la pagina (con un DOM y un fetch
// simulados) para comprobar el comportamiento del lote supervisor por grupos.

function crearEntorno(fetchMock: (url: string, init: any) => Promise<any>) {
  const elementos = new Map<string, any>();
  const el = (id: string) => {
    if (!elementos.has(id)) {
      elementos.set(id, { id, style: {}, innerHTML: "", innerText: "", value: "", disabled: false });
    }
    return elementos.get(id);
  };
  const sandbox: any = {
    document: {
      getElementById: el,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ style: {} }),
    },
    fetch: fetchMock,
    console,
    Promise,
    JSON,
    URLSearchParams,
    setTimeout,
    clearInterval,
    setInterval: () => 0,
    location: { search: "" },
    history: {},
    navigator: {},
    encodeURIComponent,
  };
  sandbox.window = sandbox;

  const html = generarDashboardHTML({ causa: "x" });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  vm.createContext(sandbox);
  vm.runInContext(scripts[0][1], sandbox);
  return { sandbox, el };
}

async function esperarFin(sandbox: any) {
  for (let i = 0; i < 400 && sandbox.supervisor.enCurso; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(sandbox.supervisor.enCurso, false, "el lote no termino");
}

function filasDePrueba(n: number): string {
  const lineas: string[] = [];
  for (let i = 0; i < n; i++) {
    lineas.push(["01000000" + String(i).padStart(2, "0"), "APELLIDO" + i, "NOMBRE" + i, "OP-" + i].join("\t"));
  }
  return lineas.join("\n");
}

function respuestaOk(personas: any[]) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      filas: personas.map((p: any) => ({ ...p, sinCausaVigente: true, totalCausasEncontradas: 0 })),
    }),
  };
}

test("envia la lista en grupos de 5 y muestra el progreso", async () => {
  const tamanos: number[] = [];
  const { sandbox, el } = crearEntorno(async (_url, init) => {
    const personas = JSON.parse(init.body).personas;
    tamanos.push(personas.length);
    return respuestaOk(personas);
  });
  el("inputSupervisorLote").value = filasDePrueba(12);
  sandbox.window.ejecutarLoteSupervisor();
  await esperarFin(sandbox);

  assert.deepEqual(tamanos, [5, 5, 2]);
  assert.match(el("supervisorProgresoTexto").innerText, /Procesadas 12 de 12 \(100%\)/);
  assert.equal(el("supervisorBarra").style.width, "100%");
  assert.equal(el("btnSupervisorReintentar").style.display, "none");
  assert.equal(el("supervisorTbody").innerHTML.split("<tr>").length - 1, 12);
});

test("un grupo que falla solo marca sus filas y el reintento las recupera", async () => {
  let llamada = 0;
  let fallar = true;
  const lotes: number[] = [];
  const { sandbox, el } = crearEntorno(async (_url, init) => {
    llamada++;
    const personas = JSON.parse(init.body).personas;
    lotes.push(personas.length);
    if (fallar && llamada === 2) throw new Error("timeout");
    return respuestaOk(personas);
  });
  el("inputSupervisorLote").value = filasDePrueba(12);
  sandbox.window.ejecutarLoteSupervisor();
  await esperarFin(sandbox);

  assert.deepEqual(lotes, [5, 5, 2], "un grupo fallido no debe detener los siguientes");
  assert.match(el("supervisorProgresoTexto").innerText, /Procesadas 12 de 12/);
  assert.match(el("supervisorProgresoTexto").innerText, /5 con error/);
  assert.equal(el("btnSupervisorReintentar").style.display, "inline-block");
  assert.ok(el("supervisorTbody").innerHTML.includes("No procesado"));

  fallar = false;
  lotes.length = 0;
  sandbox.window.reintentarLoteSupervisor();
  await esperarFin(sandbox);

  assert.deepEqual(lotes, [5], "el reintento solo reenvia las filas con error");
  assert.doesNotMatch(el("supervisorProgresoTexto").innerText, /con error/);
  assert.equal(el("btnSupervisorReintentar").style.display, "none");
  assert.ok(!el("supervisorTbody").innerHTML.includes("No procesado"));
});

test("un error HTTP del servidor tambien marca solo ese grupo", async () => {
  let llamada = 0;
  const { sandbox, el } = crearEntorno(async (_url, init) => {
    llamada++;
    const personas = JSON.parse(init.body).personas;
    if (llamada === 1) {
      return { ok: false, json: async () => ({ ok: false, error: "SATJE_API_KEY no esta configurado" }) };
    }
    return respuestaOk(personas);
  });
  el("inputSupervisorLote").value = filasDePrueba(7);
  sandbox.window.ejecutarLoteSupervisor();
  await esperarFin(sandbox);

  assert.match(el("supervisorProgresoTexto").innerText, /5 con error/);
  assert.ok(el("supervisorTbody").innerHTML.includes("SATJE_API_KEY no esta configurado"));
});

test("cancelar detiene los grupos siguientes y deja el resto pendiente", async () => {
  let llamada = 0;
  let cancelar: () => void = () => {};
  const { sandbox, el } = crearEntorno(async (_url, init) => {
    llamada++;
    const personas = JSON.parse(init.body).personas;
    if (llamada === 1) cancelar();
    return respuestaOk(personas);
  });
  cancelar = () => sandbox.window.cancelarLoteSupervisor();
  el("inputSupervisorLote").value = filasDePrueba(12);
  sandbox.window.ejecutarLoteSupervisor();
  await esperarFin(sandbox);

  assert.equal(llamada, 1);
  assert.match(el("supervisorProgresoTexto").innerText, /Procesadas 5 de 12/);
  assert.match(el("supervisorProgresoTexto").innerText, /cancelado/);
  assert.ok(el("supervisorTbody").innerHTML.includes("Pendiente"));
  assert.equal(el("btnSupervisorReintentar").style.display, "inline-block");
});

test("rechaza listas de mas de 100 personas sin llamar al servidor", () => {
  let llamadas = 0;
  const { sandbox, el } = crearEntorno(async () => {
    llamadas++;
    return { ok: true, json: async () => ({}) };
  });
  el("inputSupervisorLote").value = filasDePrueba(101);
  sandbox.window.ejecutarLoteSupervisor();
  assert.equal(llamadas, 0);
  assert.match(el("supervisorMensaje").innerHTML, /máximo/);
});

test("una fila con busqueda incompleta muestra la advertencia en su celda", async () => {
  const { sandbox, el } = crearEntorno(async (_url, init) => {
    const personas = JSON.parse(init.body).personas;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        filas: personas.map((p: any) => ({
          ...p,
          sinCausaVigente: false,
          numeroProceso: "01204-2022-01413G",
          busquedaIncompleta: true,
          advertenciaBusqueda: "fallo la busqueda como demandado (SATJE_TIMEOUT)",
        })),
      }),
    };
  });
  el("inputSupervisorLote").value = filasDePrueba(1);
  sandbox.window.ejecutarLoteSupervisor();
  await esperarFin(sandbox);

  const tabla = el("supervisorTbody").innerHTML;
  assert.ok(tabla.includes("Búsqueda incompleta"));
  assert.ok(tabla.includes("fallo la busqueda como demandado"));
  assert.ok(tabla.includes("01204-2022-01413G"));
});

// --- Tabla de procesos por cedula: columna Judicatura ---

test("sin nombre de judicatura se muestra su codigo (primeros 5 caracteres del proceso)", async () => {
  const { sandbox, el } = crearEntorno(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      cedula: "0105249684",
      procesos: [
        { numeroProceso: "01U03202373295", judicatura: null, accion: "CONTRAVENCION", fechaIngreso: "2023-08-23T10:00:00", estadoActual: "A" },
        { numeroProceso: "01204202201413G", judicatura: null, accion: "TUTELA", fechaIngreso: "2022-11-28T10:00:00", estadoActual: "A" },
        { numeroProceso: "01333202104213", judicatura: "UNIDAD JUDICIAL CIVIL CUENCA", accion: "COBRO", fechaIngreso: "2021-06-09T10:00:00", estadoActual: "A" },
      ],
    }),
  }));
  el("inputSearchCedula").value = "0105249684";
  sandbox.window.buscarProcesosPorCedula();
  for (let i = 0; i < 100 && !el("cedulaResultados").innerHTML.includes("cedulaTable"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const tabla = el("cedulaResultados").innerHTML;
  assert.ok(tabla.includes("Cód. 01U03"), "proceso con letra: codigo 01U03");
  assert.ok(tabla.includes("Cód. 01204"), "proceso con letra al final: codigo 01204");
  assert.ok(tabla.includes("UNIDAD JUDICIAL CIVIL CUENCA"), "si SATJE da el nombre, se usa");
  assert.equal((tabla.match(/Cód\./g) || []).length, 2, "solo las dos sin nombre muestran codigo");
});

// ---- Buscador de reinicio: no debe afirmar "no hay" cuando la busqueda quedo a medias.

async function buscarReinicio(respuesta: any) {
  const { sandbox, el } = crearEntorno(async () => ({ ok: true, json: async () => respuesta }));
  el("reinicioCedulaInput").value = "0000000000";
  sandbox.buscarReinicioAbandono();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  return el("reinicioResultados").innerHTML as string;
}

test("reinicio: busqueda completa sin candidatos dice que no se encontraron", async () => {
  const out = await buscarReinicio({ ok: true, asuntoDetectado: "COBRO DE PAGARE A LA ORDEN", totalCausasCedula: 3, candidatos: [], busquedaIncompleta: false });
  assert.ok(out.includes("No se encontraron causas nuevas"));
  assert.ok(!out.includes("incompleta"));
});

test("reinicio: busqueda incompleta sin candidatos NO afirma que no hay reinicio", async () => {
  const out = await buscarReinicio({
    ok: true,
    asuntoDetectado: "COBRO DE PAGARE A LA ORDEN",
    totalCausasCedula: 3,
    candidatos: [],
    busquedaIncompleta: true,
    advertenciaBusqueda: "fallo la busqueda como demandado (SATJE_TIMEOUT)",
  });
  assert.ok(out.includes("incompleta"));
  assert.ok(out.includes("demandado"), "debe decir que parte fallo");
  assert.ok(!out.includes("No se encontraron causas nuevas"));
});

test("reinicio: con candidatos y busqueda incompleta muestra ambos", async () => {
  const out = await buscarReinicio({
    ok: true,
    asuntoDetectado: "COBRO DE PAGARE A LA ORDEN",
    totalCausasCedula: 3,
    candidatos: [{ numeroProceso: "01333-2026-10304", fechaIngreso: "2026-09-09", judicatura: "CUENCA" }],
    busquedaIncompleta: true,
    advertenciaBusqueda: "SATJE no respondio por completo",
  });
  assert.ok(out.includes("01333-2026-10304"));
  assert.ok(out.includes("incompleta"));
});
