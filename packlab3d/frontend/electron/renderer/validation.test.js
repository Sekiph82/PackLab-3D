import { validateMeasurementForm, isFormValid } from './validation.js';

test('requires packagingType', () => {
  const errors = validateMeasurementForm({ widthMm: 10 });
  expect(errors.packagingType).toBe('common.requiredField');
});

test('requires at least one dimension', () => {
  const errors = validateMeasurementForm({ packagingType: 'bottle' });
  expect(errors.dimensions).toBe('common.requiredField');
});

test('accepts a single positive dimension', () => {
  const errors = validateMeasurementForm({ packagingType: 'bottle', widthMm: 50 });
  expect(errors.dimensions).toBeUndefined();
  expect(errors.widthMm).toBeUndefined();
});

test('flags negative or zero numeric fields', () => {
  const errors = validateMeasurementForm({ packagingType: 'bottle', widthMm: -5, heightMm: 0 });
  expect(errors.widthMm).toBe('common.invalidNumber');
  expect(errors.heightMm).toBe('common.invalidNumber');
});

test('flags non-numeric input', () => {
  const errors = validateMeasurementForm({ packagingType: 'bottle', widthMm: 'abc' });
  expect(errors.widthMm).toBe('common.invalidNumber');
});

test('isFormValid true for a valid form', () => {
  expect(isFormValid({ packagingType: 'box', widthMm: 10, heightMm: 20, depthMm: 30 })).toBe(true);
});

test('isFormValid false when packagingType missing', () => {
  expect(isFormValid({ widthMm: 10 })).toBe(false);
});
