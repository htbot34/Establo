import { describe, expect, it } from 'vitest';
import {
  FARM_CE_AREAS,
  expectedCeAreasForRole,
  isValidFarmTopic,
  mapToFarmTopic,
} from '../../src/server/services/farmTopics.js';

describe('FARM Animal Care v5 topic mapping (keyword table, no LLM)', () => {
  it('maps the <meta topic/> taxonomy to FARM areas', () => {
    expect(mapToFarmTopic('Manejo de animales')).toBe('stockmanship_general');
    expect(mapToFarmTopic('Salud animal')).toBe('stockmanship_general');
    expect(mapToFarmTopic('Cuidado de becerras')).toBe('preweaned_calf');
    expect(mapToFarmTopic('Químicos y seguridad')).toBe('safety_other');
  });

  it('milk-quality topics are not FARM CE areas', () => {
    expect(mapToFarmTopic('Ordeño')).toBe('none');
    expect(mapToFarmTopic('Higiene')).toBe('none');
    expect(mapToFarmTopic('Equipo y mantenimiento')).toBe('none');
    expect(mapToFarmTopic('Otro')).toBe('none');
  });

  it('question-text keywords override the topic table for job-specific areas', () => {
    expect(mapToFarmTopic('Salud animal', '¿qué hago con una vaca caída que no se para?')).toBe(
      'non_ambulatory',
    );
    expect(mapToFarmTopic('Salud animal', '¿cuándo se decide la eutanasia de una vaca?')).toBe(
      'euthanasia',
    );
    expect(
      mapToFarmTopic('Manejo de animales', '¿esta vaca está apta para el transporte al rastro?'),
    ).toBe('fitness_to_transport');
    expect(mapToFarmTopic('Otro', '¿cuánto calostro le doy a la becerra?')).toBe('preweaned_calf');
    expect(mapToFarmTopic('Otro', '¿se puede usar la chicharra para mover vacas?')).toBe(
      'stockmanship_general',
    );
  });

  it('falls back to none for unknown topics and unrelated text', () => {
    expect(mapToFarmTopic('???', 'hola buenos días')).toBe('none');
    expect(mapToFarmTopic('', '')).toBe('none');
  });

  it('the five CE areas and validator agree with the enum', () => {
    expect(FARM_CE_AREAS).toHaveLength(5);
    for (const area of FARM_CE_AREAS) expect(isValidFarmTopic(area)).toBe(true);
    expect(isValidFarmTopic('none')).toBe(true);
    expect(isValidFarmTopic('banana')).toBe(false);
  });
});

describe('FARM v5 CE areas scoped to a worker job role (expectedCeAreasForRole)', () => {
  it('milkers (ordeno) get only stockmanship, never euthanasia', () => {
    expect(expectedCeAreasForRole('ordeno')).toEqual(['stockmanship_general']);
    expect(expectedCeAreasForRole('ordeno')).not.toContain('euthanasia');
  });

  it('herd health (salud_hato) carries euthanasia and non-ambulatory', () => {
    const areas = expectedCeAreasForRole('salud_hato');
    expect(areas).toContain('euthanasia');
    expect(areas).toContain('non_ambulatory');
  });

  it('calf care (becerras) carries pre-weaned calf plus stockmanship', () => {
    const areas = expectedCeAreasForRole('becerras');
    expect(areas).toContain('preweaned_calf');
    expect(areas).toContain('stockmanship_general');
  });

  it('general covers all five FARM CE areas', () => {
    expect(expectedCeAreasForRole('general')).toEqual(FARM_CE_AREAS);
  });

  it('null and unknown roles fall back to the stockmanship baseline', () => {
    expect(expectedCeAreasForRole(null)).toEqual(['stockmanship_general']);
    expect(expectedCeAreasForRole('tractorista')).toEqual(['stockmanship_general']);
  });
});
