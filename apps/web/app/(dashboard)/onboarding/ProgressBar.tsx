const STEP_LABELS = ['Workspace', 'Connect', 'First step'];

// Plain divs, no library — server-renderable (no interactivity needed).
export function ProgressBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1;
          const isComplete = stepNumber < step;
          const isActive = stepNumber === step;
          return (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isComplete || isActive
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isComplete ? (
                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
                    <path
                      d="M3 8.5l3 3 7-7"
                      stroke="currentColor"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  stepNumber
                )}
              </div>
              {stepNumber < STEP_LABELS.length && (
                <div className={`h-0.5 flex-1 ${isComplete ? 'bg-primary-600' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>
          Step {step} of {STEP_LABELS.length}
        </span>
        <span className="font-medium text-gray-700">{STEP_LABELS[step - 1]}</span>
      </div>
    </div>
  );
}
