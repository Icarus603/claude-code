import { useMemo } from 'react'

type FeedbackSurveyOriginal = {
  handleSelect: (selected: 'dismissed' | 'bad' | 'fine' | 'good') => boolean
  [key: string]: unknown
}

export type FeedbackSurveyAutoIssueHandlers = {
  /**
   * Called before the original handler runs, to clear any prior auto-run
   * marker. Lets the host reset its didAutoRunIssue ref.
   */
  resetMarker: () => void
  /**
   * Gate for whether the auto-issue should fire for the given reason.
   */
  shouldAutoRun: (reason: string) => boolean
  /**
   * Called when auto-issue should fire (selected="bad", transcript prompt
   * not shown, gate true). Host sets autoRunIssueReason + marker ref.
   */
  triggerAutoRun: (reason: string) => void
}

/**
 * Wraps useFeedbackSurvey output to auto-trigger /issue when the user picks
 * "bad" and the transcript prompt would not otherwise be shown.
 *
 * V7 §3.3 — extracted from REPLView.tsx. The host owns the marker ref and
 * autoRunIssueReason state; this hook owns the wrapping policy. Callbacks
 * avoid TDZ on the host's ref/setter (they're declared after the call site).
 */
export function useFeedbackSurveyAutoIssue<T extends FeedbackSurveyOriginal>(
  feedbackSurveyOriginal: T,
  handlers: FeedbackSurveyAutoIssueHandlers,
): T {
  const { resetMarker, shouldAutoRun, triggerAutoRun } = handlers
  return useMemo(
    () =>
      ({
        ...feedbackSurveyOriginal,
        handleSelect: (selected: 'dismissed' | 'bad' | 'fine' | 'good') => {
          resetMarker()
          const showedTranscriptPrompt = feedbackSurveyOriginal.handleSelect(selected)
          if (
            selected === 'bad' &&
            !showedTranscriptPrompt &&
            shouldAutoRun('feedback_survey_bad')
          ) {
            triggerAutoRun('feedback_survey_bad')
          }
          return showedTranscriptPrompt
        },
      }) as T,
    [feedbackSurveyOriginal, resetMarker, shouldAutoRun, triggerAutoRun],
  )
}
