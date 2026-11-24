
"use client";

import { useMemo, useState } from "react";
import { createAppointment } from "@/lib/appointment-actions";

type PatientOption = {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
};

type ProviderOption = {
  id: string;
  displayName: string;
  specialty: string;
};

export default function AppointmentForm({
  patients,
  providers,
  defaultDate,
  error,
}: {
  patients: PatientOption[];
  providers: ProviderOption[];
  defaultDate: string;
  error?: string;
}) {
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");

  const filteredPatients = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return patients;

    return patients.filter((patient) =>
      `${patient.firstName} ${patient.lastName} ${patient.mrn}`
        .toLowerCase()
        .includes(term)
    );
  }, [patients, search]);

  const selectedPatient = patients.find(
    (patient) => patient.id === patientId
  );

  const errorMessages: Record<string, string> = {
    invalid: "Please check all appointment details and try again.",
    "invalid-time":
      "This time does not exist in the practice timezone, possibly because of a daylight-saving change. Please choose another time.",
    conflict:
      "This provider already has an appointment during the selected time. Choose another time or provider.",
    "invalid-selection":
      "The selected patient or provider is no longer available. Please refresh and try again.",
    retry:
      "Another scheduling operation occurred at the same time. Please try again.",
    unauthorized: "You do not have permission to create appointments.",
  };

  return (
    <section className="card p-6">
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {errorMessages[error] ??
            "The appointment could not be created. Please try again."}
        </div>
      )}

      {patients.length === 0 || providers.length === 0 ? (
        <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          {patients.length === 0
            ? "No active patients are available. Register a patient before scheduling."
            : "No active providers are available. Add a provider before scheduling."}
        </div>
      ) : (
        <form action={createAppointment} className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              Patient information
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Search by patient name or medical record number.
            </p>
          </div>

          <div>
            <label
              htmlFor="patientSearch"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Search patient
            </label>

            <input
              id="patientSearch"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPatientId("");
              }}
              placeholder="Enter patient name or MRN..."
              className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm outline-none focus:border-teal"
            />

            {search && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                {filteredPatients.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">
                    No matching patients found.
                  </p>
                ) : (
                  filteredPatients.map((patient) => (
                    <button
                      type="button"
                      key={patient.id}
                      onClick={() => {
                        setPatientId(patient.id);
                        setSearch(
                          `${patient.firstName} ${patient.lastName} (${patient.mrn})`
                        );
                      }}
                      className="block w-full border-b border-slate-100 px-4 py-3 text-left text-sm last:border-0 hover:bg-slate-50"
                    >
                      <span className="font-semibold text-ink">
                        {patient.firstName} {patient.lastName}
                      </span>
                      <span className="ml-2 text-slate-500">
                        {patient.mrn}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            <input type="hidden" name="patientId" value={patientId} />

            {selectedPatient && (
              <p className="mt-2 text-sm text-teal">
                Selected: {selectedPatient.firstName}{" "}
                {selectedPatient.lastName}
              </p>
            )}
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h2 className="text-lg font-semibold text-ink">
              Appointment details
            </h2>
          </div>

          <div>
            <label
              htmlFor="providerId"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Provider
            </label>
            <select
              id="providerId"
              name="providerId"
              required
              defaultValue=""
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
            >
              <option value="" disabled>
                Select provider
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName} — {provider.specialty}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label
                htmlFor="date"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Appointment date
              </label>
              <input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="time"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Start time
              </label>
              <input
                id="time"
                name="time"
                type="time"
                required
                defaultValue="09:00"
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label
                htmlFor="durationMin"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Appointment duration
              </label>
              <select
                id="durationMin"
                name="durationMin"
                defaultValue="30"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes — Default</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="visitType"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Visit type
              </label>
              <select
                id="visitType"
                name="visitType"
                required
                defaultValue=""
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <option value="" disabled>
                  Select visit type
                </option>
                <option value="New patient">New patient</option>
                <option value="Follow-up">Follow-up</option>
                <option value="Annual wellness">Annual wellness</option>
                <option value="Sick visit">Sick visit</option>
                <option value="Consultation">Consultation</option>
                <option value="Telehealth">Telehealth</option>
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm text-teal-800">
            Appointment times are interpreted in the practice timezone.
            Provider scheduling conflicts are checked before saving.
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
            <a
              href="/schedule"
              className="rounded-lg border border-slate-200 px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </a>
            <button
              type="submit"
              disabled={!patientId}
              className="rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create appointment
            </button>
          </div>
        </form>
      )}
    </section>
  );
}