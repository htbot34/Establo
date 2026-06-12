/**
 * Printable bilingual (Spanish/English) WhatsApp-consent form for hire
 * paperwork. Covers: training messages from Establo on behalf of the
 * employer, message logging visible to the employer, voice-note
 * transcription, and how to opt out (BAJA). A signed copy is the basis for
 * the dashboard's "Consent collected on paper" toggle (manager attests).
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function consentFormHtml(dairyName: string): string {
  const name = esc(dairyName);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Consentimiento de mensajes de WhatsApp — ${name}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 46rem; margin: 2rem auto; padding: 0 1.5rem; color: #1c1917; line-height: 1.45; }
  h1 { font-size: 1.25rem; margin-bottom: 0.2rem; }
  h2 { font-size: 1rem; margin-top: 1.6rem; border-bottom: 1px solid #d6d3d1; padding-bottom: 0.2rem; }
  .en { color: #57534e; font-style: italic; }
  ul { padding-left: 1.2rem; }
  li { margin-bottom: 0.45rem; }
  .sig { margin-top: 2.2rem; display: flex; gap: 2rem; }
  .sig div { flex: 1; border-top: 1px solid #1c1917; padding-top: 0.3rem; font-size: 0.85rem; }
  .print-btn { position: fixed; top: 1rem; right: 1rem; padding: 0.5rem 1rem; font-size: 0.9rem; cursor: pointer; }
  @media print { .print-btn { display: none; } body { margin: 0.5in; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Print / Imprimir</button>

<h1>Consentimiento para mensajes de capacitación por WhatsApp</h1>
<p class="en">Consent to WhatsApp training messages</p>
<p><strong>Lechería / Dairy:</strong> ${name}</p>

<h2>Qué estoy aceptando / What I am agreeing to</h2>
<ul>
  <li>
    Acepto recibir en mi WhatsApp mensajes de capacitación de <strong>Establo</strong>, el
    asistente de capacitación que usa ${name}: lecciones programadas, preguntas de repaso,
    recordatorios y respuestas a mis preguntas sobre el trabajo.
    <div class="en">I agree to receive training messages on my WhatsApp from Establo, the training
    assistant used by ${name}: scheduled lessons, review questions, reminders, and answers to my
    work questions.</div>
  </li>
  <li>
    Entiendo que mis mensajes con Establo (preguntas, respuestas y notas de voz) se guardan como
    <strong>registros de capacitación</strong> y que mi empleador puede verlos.
    <div class="en">I understand my messages with Establo (questions, answers, and voice notes) are
    saved as training records and my employer can see them.</div>
  </li>
  <li>
    Entiendo que mis <strong>notas de voz se convierten a texto</strong> (transcripción) para
    poder responderme y guardar el registro.
    <div class="en">I understand my voice notes are transcribed to text in order to answer me and
    keep the record.</div>
  </li>
  <li>
    Entiendo que Establo no contesta temas de sueldo, legales ni de migración — esos temas son
    con mi supervisor.
    <div class="en">I understand Establo does not answer wage, legal, or immigration topics — those
    go to my supervisor.</div>
  </li>
  <li>
    Puedo dejar de recibir mensajes cuando yo quiera escribiendo <strong>BAJA</strong> en
    WhatsApp. Para volver, escribo <strong>ALTA</strong>.
    <div class="en">I can stop the messages at any time by texting BAJA on WhatsApp. To rejoin,
    I text ALTA.</div>
  </li>
</ul>

<p>
  Mi participación es voluntaria. Firmar este formulario autoriza los mensajes descritos arriba al
  número de WhatsApp que escribo abajo.
  <span class="en">My participation is voluntary. Signing this form authorizes the messages
  described above to the WhatsApp number I write below.</span>
</p>

<div class="sig">
  <div>Nombre del trabajador / Worker name</div>
  <div>Número de WhatsApp / WhatsApp number</div>
</div>
<div class="sig">
  <div>Firma del trabajador / Worker signature</div>
  <div>Fecha / Date</div>
</div>
<div class="sig">
  <div>Nombre y firma del gerente (testigo) / Manager name &amp; signature (witness)</div>
  <div>Fecha / Date</div>
</div>

<p style="margin-top:2rem;font-size:0.8rem;color:#57534e;">
  Guarde este formulario con el expediente del trabajador y marque “Consent collected on paper” en
  el panel de Establo. / Keep this form in the worker's file and toggle “Consent collected on
  paper” on the worker's record in the Establo dashboard.
</p>
</body>
</html>`;
}
