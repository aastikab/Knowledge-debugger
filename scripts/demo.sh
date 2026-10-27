# Demo helpers for the video. Load them into the current terminal with:
#   source scripts/demo.sh
# The server must already be running in another terminal (npm start).

B=http://localhost:3000
DEMO_LEARNER=alex

# Record a baseline attempt graded correct: attempt <questionId> "<answer>"
attempt() {
  curl -s -X POST $B/attempts -H "Content-Type: application/json" \
    -d "{\"learnerId\":\"$DEMO_LEARNER\",\"questionId\":$1,\"answer\":\"$2\",\"correct\":true}" \
    | jq -c '{question_id, is_correct}'
}

# Send a written answer to the LLM: analyze <questionId> "<answer>"
analyze() {
  curl -s -X POST $B/analyze -H "Content-Type: application/json" \
    -d "{\"learnerId\":\"$DEMO_LEARNER\",\"questionId\":$1,\"answer\":\"$2\"}" \
    | jq '{concept, responseType, understandingLevel, misconception, misconceptionCode}'
}

# Delete the demo learner's data so the demo can be recorded again
reset_demo() {
  psql -q -d knowledge_debugger -c "DELETE FROM attempts WHERE learner_id='$DEMO_LEARNER'; DELETE FROM analyses WHERE learner_id='$DEMO_LEARNER';"
  echo "Reset learner '$DEMO_LEARNER'."
}

if curl -s $B > /dev/null; then
  echo "Demo helpers loaded: attempt, analyze, reset_demo (server is running at $B)"
else
  echo "Demo helpers loaded, but the server is NOT running. Start it in another terminal with: npm start"
fi
