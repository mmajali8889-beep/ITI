import {
  useEffect,
  useState,
} from 'react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  searchPatients,
  type PatientSearchResult,
} from '../api/patientApi';

import {
  useHospital,
} from '../context/HospitalContext';

import './PatientSearch.css';

type SearchMode =
  | 'general'
  | 'mrn'
  | 'nationalId'
  | 'phone';

export default function PatientSearch() {
  const navigate = useNavigate();

  const {
    hospital,
  } = useHospital();

  const [patients, setPatients] =
    useState<PatientSearchResult[]>([]);

  const [searchMode, setSearchMode] =
    useState<SearchMode>('general');

  const [searchValue, setSearchValue] =
    useState('');

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [total, setTotal] =
    useState(0);

  useEffect(() => {
    loadPatients();
  }, [hospital?.id]);

  async function loadPatients() {
    if (!hospital?.id) {
      return;
    }

    try {
      setLoading(true);
      setError('');

      const response =
        await searchPatients({
          hospitalId: hospital.id,
        });

      setPatients(
        response.patients,
      );

      setTotal(
        response.total,
      );
    } catch (err) {
      console.error(err);

      setError(
        'Unable to load patients.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!hospital?.id) {
      return;
    }

    try {
      setLoading(true);
      setError('');

      const value =
        searchValue.trim();

      const params: {
        hospitalId: string;
        search?: string;
        mrn?: string;
        nationalId?: string;
        phone?: string;
      } = {
        hospitalId:
          hospital.id,
      };

      if (value) {
        if (
          searchMode ===
          'general'
        ) {
          params.search =
            value;
        }

        if (
          searchMode ===
          'mrn'
        ) {
          params.mrn =
            value;
        }

        if (
          searchMode ===
          'nationalId'
        ) {
          params.nationalId =
            value;
        }

        if (
          searchMode ===
          'phone'
        ) {
          params.phone =
            value;
        }
      }

      const response =
        await searchPatients(
          params,
        );

      setPatients(
        response.patients,
      );

      setTotal(
        response.total,
      );
    } catch (err) {
      console.error(err);

      setError(
        'Patient search failed.',
      );
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setSearchValue('');
    setSearchMode(
      'general',
    );

    loadPatients();
  }

  function openPatient(
    patientId: string,
  ) {
    if (!hospital?.id) {
      return;
    }

    navigate(
      `/hospital/${hospital.id}/patient/${patientId}`,
    );
  }

  function registerPatient() {
    if (!hospital?.id) {
      return;
    }

    navigate(
      `/hospital/${hospital.id}/patient/register`,
    );
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.key ===
      'Enter'
    ) {
      handleSearch();
    }
  }

  return (
    <div className="patient-search-page">

      <div className="patient-search-heading">

        <div>
          <h1>
            Patient Search
          </h1>

          <p>
            Search patients in{' '}
            {hospital?.name ??
              'the selected hospital'}
          </p>
        </div>

        <button
          type="button"
          className="new-patient-button"
          onClick={registerPatient}
        >
          + Register Patient
        </button>

      </div>


      <section className="search-panel">

        <div className="search-mode-row">

          <button
            type="button"
            className={
              searchMode ===
              'general'
                ? 'search-mode active'
                : 'search-mode'
            }
            onClick={() =>
              setSearchMode(
                'general',
              )
            }
          >
            General
          </button>


          <button
            type="button"
            className={
              searchMode ===
              'mrn'
                ? 'search-mode active'
                : 'search-mode'
            }
            onClick={() =>
              setSearchMode(
                'mrn',
              )
            }
          >
            MRN
          </button>


          <button
            type="button"
            className={
              searchMode ===
              'nationalId'
                ? 'search-mode active'
                : 'search-mode'
            }
            onClick={() =>
              setSearchMode(
                'nationalId',
              )
            }
          >
            National ID
          </button>


          <button
            type="button"
            className={
              searchMode ===
              'phone'
                ? 'search-mode active'
                : 'search-mode'
            }
            onClick={() =>
              setSearchMode(
                'phone',
              )
            }
          >
            Phone
          </button>

        </div>


        <div className="search-controls">

          <input
            className="patient-search-input"
            value={searchValue}
            onChange={(event) =>
              setSearchValue(
                event.target.value,
              )
            }
            onKeyDown={
              handleKeyDown
            }
            placeholder={
              searchMode ===
              'general'
                ? 'Search by Arabic/English name, MRN, phone or identifier...'
                : searchMode ===
                    'mrn'
                  ? 'Enter patient MRN...'
                  : searchMode ===
                      'nationalId'
                    ? 'Enter Jordan National ID...'
                    : 'Enter phone number...'
            }
          />

          <button
            type="button"
            className="search-button"
            onClick={
              handleSearch
            }
            disabled={
              loading
            }
          >
            {loading
              ? 'Searching...'
              : 'Search'}
          </button>

          <button
            type="button"
            className="clear-button"
            onClick={
              clearSearch
            }
          >
            Clear
          </button>

        </div>

      </section>


      {error && (
        <div className="patient-search-error">
          {error}
        </div>
      )}


      <div className="results-heading">

        <div>
          <h2>
            Patients
          </h2>

          <span>
            {total} result
            {total === 1
              ? ''
              : 's'}
          </span>
        </div>

      </div>


      <section className="patient-results-card">

        {loading && (
          <div className="patient-list-message">
            Loading patients...
          </div>
        )}


        {!loading &&
          patients.length ===
            0 && (
            <div className="patient-list-message">
              No patients found.
            </div>
          )}


        {!loading &&
          patients.length >
            0 && (
            <div className="patient-table-wrapper">

              <table className="patient-table">

                <thead>
                  <tr>
                    <th>
                      MRN
                    </th>

                    <th>
                      Patient
                    </th>

                    <th>
                      National ID
                    </th>

                    <th>
                      DOB
                    </th>

                    <th>
                      Gender
                    </th>

                    <th>
                      Phone
                    </th>

                    <th>
                      Status
                    </th>

                    <th />
                  </tr>
                </thead>


                <tbody>

                  {patients.map(
                    (
                      patient,
                    ) => (
                      <tr
                        key={
                          patient.id
                        }
                      >

                        <td>
                          <strong>
                            {patient.hospitalMrn ??
                              '-'}
                          </strong>
                        </td>


                        <td>
                          <div className="patient-name-cell">

                            <strong>
                              {patient.nameEn ??
                                patient.nameAr ??
                                'Unknown Patient'}
                            </strong>

                            {patient.nameAr && (
                              <span
                                dir="rtl"
                              >
                                {
                                  patient.nameAr
                                }
                              </span>
                            )}

                          </div>
                        </td>


                        <td>
                          {maskNationalId(
                            patient.nationalId,
                          )}
                        </td>


                        <td>
                          {patient.birthDate ??
                            '-'}
                        </td>


                        <td className="gender-cell">
                          {formatGender(
                            patient.gender,
                          )}
                        </td>


                        <td>
                          {patient.phone ??
                            '-'}
                        </td>


                        <td>
                          <span
                            className={
                              patient.active ===
                              false
                                ? 'patient-status inactive'
                                : 'patient-status active'
                            }
                          >
                            {patient.active ===
                            false
                              ? 'Inactive'
                              : 'Active'}
                          </span>
                        </td>


                        <td className="patient-actions-cell">

                          <button
                            type="button"
                            className="open-chart-button"
                            onClick={() =>
                              openPatient(
                                patient.id,
                              )
                            }
                          >
                            Open Chart
                          </button>

                        </td>

                      </tr>
                    ),
                  )}

                </tbody>

              </table>

            </div>
          )}

      </section>

    </div>
  );
}


function maskNationalId(
  nationalId?: string,
) {
  if (!nationalId) {
    return '-';
  }

  if (
    nationalId.length <= 4
  ) {
    return nationalId;
  }

  const visible =
    nationalId.slice(-4);

  return `${'*'.repeat(
    Math.max(
      nationalId.length -
        4,
      0,
    ),
  )}${visible}`;
}


function formatGender(
  gender?: string,
) {
  if (!gender) {
    return '-';
  }

  return (
    gender
      .charAt(0)
      .toUpperCase() +
    gender.slice(1)
  );
}