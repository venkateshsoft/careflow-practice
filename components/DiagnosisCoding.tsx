
"use client";

import DiagnosisSubmitButton from "@/components/DiagnosisSubmitButton";
import { useState, useTransition } from "react";
import {
  addEncounterDiagnosis,
  promoteEncounterDiagnosis,
  removeEncounterDiagnosis,
  searchDiagnosisCodes,
} from "@/lib/diagnosis-actions";

type Diagnosis = {
  id: string;
  code: string;
  description: string;
};

type Props = {
  encounterId: string;
  signed: boolean;
  diagnoses: (Diagnosis & { sequence: number })[];
};

function formatIcdCode(code: string) {
  if (code.length <= 3) return code;
  return `${code.slice(0, 3)}.${code.slice(3)}`;
}

export default function DiagnosisCoding({
  encounterId,
  signed,
  diagnoses,
}: Props) {
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<Diagnosis[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (searchText.trim().length < 2) {
      setResults([]);
      setMessage("Enter at least two characters to search.");
      return;
    }

    startTransition(async () => {
      const matches = await searchDiagnosisCodes(
        encounterId,
        searchText.trim()
      );

      setResults(matches);

      if (matches.length === 0) {
        setMessage("No matching billable FY2027 diagnoses found.");
      }
    });
  }

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            ICD-10-CM diagnosis coding
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            FY2027 billable diagnosis catalog
          </p>
        </div>

        <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold text-teal">
          {diagnoses.length} assigned
        </span>
      </div>

      {signed && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This encounter is signed. Diagnosis coding is read-only.
        </p>
      )}

      {!signed && (
        <>
          <form
            onSubmit={handleSearch}
            className="mt-5 flex flex-col gap-3 sm:flex-row"
          >
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search by ICD-10 code or diagnosis description"
              maxLength={100}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 p-3 text-sm"
            />

            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Searching..." : "Search"}
            </button>
          </form>

          {message && (
            <p className="mt-3 text-sm text-slate-500">{message}</p>
          )}

          {results.length > 0 && (
            <div className="mt-4 divide-y rounded-lg border border-slate-200">
              {results.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-3 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {formatIcdCode(item.code)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.description}
                    </p>
                  </div>

                  <form action={addEncounterDiagnosis}>
                    <input
                      type="hidden"
                      name="encounterId"
                      value={encounterId}
                    />
                    <input
                      type="hidden"
                      name="diagnosisCodeId"
                      value={item.id}
                    />

                    <DiagnosisSubmitButton
                      label="Add diagnosis"
                      pendingLabel="Adding..."
                      className="rounded-lg border border-teal px-4 py-2 text-sm font-semibold hover:bg-teal/5"
                    />
                  </form>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-6">
        <h3 className="font-semibold text-ink">Assigned diagnoses</h3>

        {diagnoses.length === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
            No coded diagnoses assigned to this encounter yet.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {diagnoses.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">
                    {formatIcdCode(item.code)}
                  </span>

                  <span
                    className={
                      item.sequence === 1
                        ? "rounded-full bg-teal/10 px-2 py-1 text-xs font-semibold text-teal"
                        : "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                    }
                  >
                    {item.sequence === 1 ? "Primary" : "Secondary"}
                  </span>
                </div>

                <p className="mt-2 text-sm text-slate-600">
                  {item.description}
                </p>

                {!signed && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {item.sequence !== 1 && (
                      <form action={promoteEncounterDiagnosis}>
                        <input
                          type="hidden"
                          name="encounterId"
                          value={encounterId}
                        />
                        <input
                          type="hidden"
                          name="diagnosisId"
                          value={item.id}
                        />

                        <DiagnosisSubmitButton
                          label="Make primary"
                          pendingLabel="Updating..."
                          className="text-sm font-medium hover:underline"
                        />
                      </form>
                    )}

                    <form action={removeEncounterDiagnosis}>
                      <input
                        type="hidden"
                        name="encounterId"
                        value={encounterId}
                      />
                      <input
                        type="hidden"
                        name="diagnosisId"
                        value={item.id}
                      />

                      <DiagnosisSubmitButton
                        label="Remove"
                        pendingLabel="Removing..."
                        variant="danger"
                        className="text-sm font-medium hover:underline"
                      />
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-5 text-xs text-slate-500">
        Demonstration coding only. Verify code selection and clinical
        appropriateness before any real-world use.
      </p>
    </section>
  );
}