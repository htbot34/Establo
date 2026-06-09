/**
 * Every canned worker-facing string lives here. Simple Spanish, 5th–6th
 * grade reading level, short sentences, warm tone.
 */
export const ES = {
  unregistered: 'Este número no está registrado. Pregunta a tu supervisor.',

  notFound:
    'No tengo esa información en los procedimientos de tu lechería. 🙏 ' +
    'Por favor pregunta a tu supervisor. Ya avisé al equipo para que lo revisen.',

  greeting: (name: string) =>
    `¡Hola ${name}! 👋 Soy Establo, tu ayudante de capacitación. ` +
    'Mándame tu pregunta sobre el trabajo (texto o audio) y te contesto con los procedimientos de tu lechería.',

  helpEscalated: 'Entendido. Le avisé a tu supervisor para que te ayude. 🙏',

  forbidden:
    'Ese tema lo tienes que ver directamente con tu supervisor. 🙏 ' +
    'Ya le avisé para que platique contigo.',

  imageNotSupported:
    'Por ahora no puedo ver fotos. 📷 Mándame tu pregunta por texto o por audio y con gusto te ayudo.',

  slowDown: 'Vas muy rápido 😅 Espera un momentito y vuelve a escribirme.',

  checkCorrect: '✅ ¡Correcto! Muy bien.',

  checkIncorrect: (n: number, option: string) =>
    `Gracias por responder. La respuesta correcta es: ${n}) ${option}. Repasa la lección cuando puedas. 💪`,

  checkPrompt: (question: string, options: string[]) =>
    `Pregunta rápida: ${question}\n` +
    options.map((o, i) => `${i + 1}) ${o}`).join('\n') +
    '\nResponde con el número (1, 2 o 3), o mándame un audio.',

  moduleHeader: (index: number, total: number, title: string) =>
    `📚 Lección ${index} de ${total}: *${title}*`,

  checkReminderFreeform: (title: string) =>
    `Hola 👋 Te falta responder la pregunta de tu lección "${title}". ` +
    'Mira el mensaje de arriba y responde con 1, 2 o 3.',

  trackComplete: (name: string, track: string) =>
    `🎉 ¡Felicidades, ${name}! Completaste el programa "${track}". ` +
    'Tu certificado ya quedó guardado con tu supervisor.',
} as const;

/**
 * WhatsApp template copy. In PRODUCTION these exact bodies must be submitted
 * to Meta for approval (utility category) before business-initiated sends
 * outside the 24-hour window will deliver. See README → "Meta templates".
 */
export const WHATSAPP_TEMPLATES = {
  establo_module_notify: {
    name: 'establo_module_notify',
    body: 'Hola {{1}}, tienes una lección de capacitación nueva: "{{2}}". Responde OK para recibirla.',
  },
  establo_check_reminder: {
    name: 'establo_check_reminder',
    body: 'Hola {{1}}, te falta responder la pregunta de tu lección: "{{2}}". Responde con el número de tu respuesta (1, 2 o 3).',
  },
} as const;

export type TemplateName = keyof typeof WHATSAPP_TEMPLATES;

export function renderTemplate(name: TemplateName, vars: string[]): string {
  let body: string = WHATSAPP_TEMPLATES[name].body;
  vars.forEach((v, i) => {
    body = body.replaceAll(`{{${i + 1}}}`, v);
  });
  return body;
}
