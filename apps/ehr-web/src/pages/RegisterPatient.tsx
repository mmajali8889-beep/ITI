import {
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import { useNavigate } from 'react-router-dom';

import { createPatient } from '../api/patientApi';

import { useHospital } from '../context/HospitalContext';

import type { CreatePatientRequest } from '../types/patient';

import './RegisterPatient.css';


export default function RegisterPatient() {
  const navigate = useNavigate();

  const { hospital } = useHospital();

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState('');

  const initialForm =
    useMemo<CreatePatientRequest>(
      () => ({
        hospitalId:
          hospital?.id ?? '',

        hospitalCode:
          hospital?.code ?? '',

        hospitalMrn: '',

        nationalId: '',
        passportNumber: '',

        firstNameAr: '',
        middleNameAr: '',
        familyNameAr: '',

        firstNameEn: '',
        middleNameEn: '',
        familyNameEn: '',

        gender: 'unknown',

        birthDate: '',

        phone: '',

        nationality: 'Jordanian',

        addressLine: '',
        city: '',
        country: 'JO',

        nextOfKinName: '',
        nextOfKinRelationship: '',
        nextOfKinPhone: '',

        registrationConfirmed: true,
      }),
      [hospital]
    );

  const [form, setForm] =
    useState<CreatePatientRequest>(
      initialForm
    );


  function updateField(
    field: keyof CreatePatientRequest,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }


  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError('');

    if (!hospital) {
      setError(
        'No hospital selected.'
      );

      return;
    }

    if (
      !form.firstNameAr ||
      !form.familyNameAr
    ) {
      setError(
        'Arabic first name and family name are required.'
      );

      return;
    }

    if (!form.hospitalMrn) {
      setError(
        'Hospital MRN is required.'
      );

      return;
    }

    if (!form.birthDate) {
      setError(
        'Date of birth is required.'
      );

      return;
    }

    try {
      setSaving(true);

      const payload: CreatePatientRequest = {
        ...form,

        hospitalId:
          hospital.id,

        hospitalCode:
          hospital.code,
      };

      const created =
        await createPatient(payload);

      navigate(
        `/hospital/${hospital.id}/patient/${created.id}`
      );

    } catch (err: any) {
      console.error(err);

      const message =
        err?.response?.data?.message;

      if (Array.isArray(message)) {
        setError(
          message.join(', ')
        );

      } else if (message) {
        setError(message);

      } else {
        setError(
          'Failed to register patient.'
        );
      }

    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="register-patient-page">

      <div className="registration-heading">

        <div>
          <h1>
            Register Patient
          </h1>

          <p>
            Register a new patient in {hospital?.name}
          </p>
        </div>

      </div>


      {error && (
        <div className="form-error">
          {error}
        </div>
      )}


      <form
        className="patient-form"
        onSubmit={handleSubmit}
      >

        <FormSection
          title="Patient Identifiers"
          description="Hospital and government identifiers"
        >

          <FormGrid>

            <Field
              label="Hospital MRN"
              required
            >
              <input
                value={form.hospitalMrn}
                onChange={(event) =>
                  updateField(
                    'hospitalMrn',
                    event.target.value
                  )
                }
                placeholder="HA-000001"
              />
            </Field>


            <Field label="Enterprise MRN">
              <input
                value={
                  form.enterpriseMrn ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'enterpriseMrn',
                    event.target.value
                  )
                }
                placeholder="E00000001"
              />
            </Field>


            <Field label="Jordan National ID">
              <input
                value={
                  form.nationalId ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'nationalId',
                    event.target.value
                  )
                }
                placeholder="National ID"
              />
            </Field>


            <Field label="Passport Number">
              <input
                value={
                  form.passportNumber ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'passportNumber',
                    event.target.value
                  )
                }
                placeholder="Passport"
              />
            </Field>

          </FormGrid>

        </FormSection>


        <FormSection
          title="Arabic Name"
          description="Patient official Arabic name"
        >

          <FormGrid columns={3}>

            <Field
              label="First Name"
              required
            >
              <input
                dir="rtl"
                value={form.firstNameAr}
                onChange={(event) =>
                  updateField(
                    'firstNameAr',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field label="Middle Name">
              <input
                dir="rtl"
                value={
                  form.middleNameAr ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'middleNameAr',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field
              label="Family Name"
              required
            >
              <input
                dir="rtl"
                value={form.familyNameAr}
                onChange={(event) =>
                  updateField(
                    'familyNameAr',
                    event.target.value
                  )
                }
              />
            </Field>

          </FormGrid>

        </FormSection>


        <FormSection
          title="English Name"
          description="Optional English representation"
        >

          <FormGrid columns={3}>

            <Field label="First Name">
              <input
                value={
                  form.firstNameEn ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'firstNameEn',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field label="Middle Name">
              <input
                value={
                  form.middleNameEn ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'middleNameEn',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field label="Family Name">
              <input
                value={
                  form.familyNameEn ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'familyNameEn',
                    event.target.value
                  )
                }
              />
            </Field>

          </FormGrid>

        </FormSection>


        <FormSection
          title="Demographics"
          description="Basic demographic information"
        >

          <FormGrid columns={3}>

            <Field
              label="Gender"
              required
            >
              <select
                value={form.gender}
                onChange={(event) =>
                  updateField(
                    'gender',
                    event.target.value
                  )
                }
              >
                <option value="unknown">
                  Select
                </option>

                <option value="male">
                  Male
                </option>

                <option value="female">
                  Female
                </option>

                <option value="other">
                  Other
                </option>
              </select>
            </Field>


            <Field
              label="Date of Birth"
              required
            >
              <input
                type="date"
                value={form.birthDate}
                onChange={(event) =>
                  updateField(
                    'birthDate',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field label="Nationality">
              <input
                value={
                  form.nationality ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'nationality',
                    event.target.value
                  )
                }
              />
            </Field>

          </FormGrid>

        </FormSection>


        <FormSection
          title="Contact Information"
          description="Phone number and home address"
        >

          <FormGrid>

            <Field label="Mobile Number">
              <input
                value={
                  form.phone ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'phone',
                    event.target.value
                  )
                }
                placeholder="0790000000"
              />
            </Field>


            <Field label="City">
              <input
                value={
                  form.city ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'city',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field label="Address">
              <input
                value={
                  form.addressLine ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'addressLine',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field label="Country">
              <input
                value={
                  form.country ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'country',
                    event.target.value
                  )
                }
              />
            </Field>

          </FormGrid>

        </FormSection>


        <FormSection
          title="Next of Kin"
          description="Emergency / family contact"
        >

          <FormGrid columns={3}>

            <Field label="Full Name">
              <input
                value={
                  form.nextOfKinName ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'nextOfKinName',
                    event.target.value
                  )
                }
              />
            </Field>


            <Field label="Relationship">
              <select
                value={
                  form.nextOfKinRelationship ??
                  ''
                }
                onChange={(event) =>
                  updateField(
                    'nextOfKinRelationship',
                    event.target.value
                  )
                }
              >
                <option value="">
                  Select
                </option>

                <option value="Father">
                  Father
                </option>

                <option value="Mother">
                  Mother
                </option>

                <option value="Spouse">
                  Spouse
                </option>

                <option value="Brother">
                  Brother
                </option>

                <option value="Sister">
                  Sister
                </option>

                <option value="Son">
                  Son
                </option>

                <option value="Daughter">
                  Daughter
                </option>

                <option value="Other">
                  Other
                </option>
              </select>
            </Field>


            <Field label="Phone">
              <input
                value={
                  form.nextOfKinPhone ?? ''
                }
                onChange={(event) =>
                  updateField(
                    'nextOfKinPhone',
                    event.target.value
                  )
                }
              />
            </Field>

          </FormGrid>

        </FormSection>


        <div className="form-actions">

          <button
            type="button"
            className="cancel-button"
            onClick={() =>
              navigate(
                `/hospital/${hospital?.id}/dashboard`
              )
            }
          >
            Cancel
          </button>


          <button
            type="submit"
            className="save-patient-button"
            disabled={saving}
          >
            {saving
              ? 'Registering...'
              : 'Register Patient'}
          </button>

        </div>

      </form>

    </div>
  );
}


function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="form-section">

      <div className="form-section-heading">

        <h2>
          {title}
        </h2>

        {description && (
          <p>
            {description}
          </p>
        )}

      </div>

      {children}

    </section>
  );
}


function FormGrid({
  children,
  columns = 2,
}: {
  children: React.ReactNode;
  columns?: number;
}) {
  return (
    <div
      className="form-grid"
      style={{
        gridTemplateColumns:
          `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}


function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">

      <span>
        {label}

        {required && (
          <b>
            *
          </b>
        )}
      </span>

      {children}

    </label>
  );
}
