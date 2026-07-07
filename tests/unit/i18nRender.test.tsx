/**
 * Render test: a representative dashboard page (Login — the one page that
 * renders fully without fetched data) shows Spanish strings when the locale
 * context is 'es' and English when it is 'en'. Uses react-dom/server so no
 * DOM emulation is needed; effects don't run, which is exactly what we want
 * for a static-markup assertion.
 */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LocaleContext, LocaleToggle, type Locale } from '../../src/web/i18n';
import Login from '../../src/web/pages/Login';

function renderLogin(locale: Locale): string {
  return renderToString(
    <MemoryRouter initialEntries={['/login']}>
      <LocaleContext.Provider value={{ locale, setLocale: () => {} }}>
        <Login />
      </LocaleContext.Provider>
    </MemoryRouter>,
  );
}

describe('Login page locale rendering', () => {
  it("shows Spanish strings when locale='es'", () => {
    const html = renderLogin('es');
    expect(html).toContain('Iniciar sesión');
    expect(html).toContain('Registrar una lechería');
    expect(html).toContain('Correo electrónico');
    expect(html).toContain('Contraseña');
    expect(html).toContain('Capacitación y consulta de SOPs por WhatsApp para tu lechería');
    expect(html).not.toContain('Sign in');
    expect(html).not.toContain('Password');
  });

  it("shows English strings when locale='en'", () => {
    const html = renderLogin('en');
    expect(html).toContain('Sign in');
    expect(html).toContain('Set up a dairy');
    expect(html).toContain('Email');
    expect(html).toContain('Password');
    expect(html).not.toContain('Iniciar sesión');
  });
});

describe('LocaleToggle', () => {
  function renderToggle(locale: Locale): string {
    return renderToString(
      <LocaleContext.Provider value={{ locale, setLocale: () => {} }}>
        <LocaleToggle />
      </LocaleContext.Provider>,
    );
  }

  it('renders both options and marks the active locale', () => {
    const html = renderToggle('es');
    expect(html).toContain('>EN<');
    expect(html).toContain('>ES<');
    // aria-pressed reflects the active segment, in order EN then ES.
    expect(html.indexOf('aria-pressed="false"')).toBeLessThan(
      html.indexOf('aria-pressed="true"'),
    );
    // aria-label is localized.
    expect(html).toContain('Cambiar el idioma del panel a inglés');
  });
});
