const NUMERIC_FIELDS = ['widthMm', 'heightMm', 'depthMm', 'diameterMm', 'volumeMl'];

export function validateMeasurementForm(values) {
  const errors = {};

  if (!values.packagingType) {
    errors.packagingType = 'common.requiredField';
  }

  NUMERIC_FIELDS.forEach((field) => {
    const raw = values[field];
    if (raw === undefined || raw === null || raw === '') return;
    const num = Number(raw);
    if (Number.isNaN(num) || num <= 0) {
      errors[field] = 'common.invalidNumber';
    }
  });

  const hasAnyDimension = ['widthMm', 'heightMm', 'depthMm', 'diameterMm'].some(
    (field) => values[field] !== undefined && values[field] !== null && values[field] !== ''
  );
  if (!hasAnyDimension) {
    errors.dimensions = 'common.requiredField';
  }

  return errors;
}

export function isFormValid(values) {
  return Object.keys(validateMeasurementForm(values)).length === 0;
}
