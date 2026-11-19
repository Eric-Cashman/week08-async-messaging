AI Output Audit: Order Fulfillment (REST + RabbitMQ)
Tool: Claude (AI draft generated from the prompt in PROMPTS.md)
Draft (before): ai-draft/, committed untouched as "Raw AI draft"
Patched version (after): app/, one commit per fix
Method: (1) read the code against the checklist, (2) run it, (3) break it on purpose, (4) patch and re-test
Line numbers refer to the files in ai-draft/src/. Read = confirmed by reading the code. Ran = confirmed by running the system.
1. Assignment checklist (the four required items)
#	Check	Verdict	Where in the code (Read)	Confirmed by running (Ran)
1	Real external broker, not an in-memory array	Pass: RabbitMQ via amqplib; status in Redis	rabbit.ts:32 (assertQueue), docker-compose.yml	Both containers healthy; worker consumed orders from orders.fulfillment
2	API responds immediately (202), does not wait for the worker	Pass: 202 is sent after the broker confirms the publish, not after processing	api.ts:87, api.ts:97 (.status(202))	Five rapid POSTs took 9, 7, 6, 5 and 6 ms; each order reached completed about 3-5s later
3	Explicit ACK only after successful processing; no auto-ack	Pass: noAck: false; ACK after the work and the final status update	worker.ts:74, worker.ts:50	Worker log shows ACK after each job finished
4	Durable queue and persistent messages	Pass: queue durable: true; messages persistent: true	rabbit.ts:32, api.ts:50	RabbitMQ UI shows durable: true; a message survived a hard kill of the worker and was redelivered
2. Beyond the four required items
Check	What the draft did	Result
Idempotency	worker.ts:46-51 did the work on every delivery, with no check of the order's state	Ran: flaw confirmed, then fixed. A duplicate delivery was fulfilled twice. After the patch, duplicates are ACKed and skipped.
Dead-letter queue	worker.ts:40 rejected bad messages with requeue=false, and the queue had no dead-letter settings	Ran: flaw confirmed, then fixed. The malformed message was discarded. After the patch it lands in orders.fulfillment.dlq.
Retry limits	worker.ts:56 requeues immediately on any error, with no attempt counter or delay	Read only. Not reproduced, not patched.
failed status	The worker never sets failed (worker.ts:38-41, worker.ts:55)	Read only. Not reproduced, not patched.
Status regression on redelivery	worker.ts:47 set processing even on an already-completed order	Read only. Addressed as a side effect of the idempotency guard; not separately reproduced.
Crash recovery	ACK only after the work, so a killed worker leaves messages unacked	Ran: works as designed (a strength). The message returned with redelivered=true and completed.
Concurrency	prefetch(1)	Ran: confirmed. Unacked never exceeded 1; jobs ran strictly one after another.

Minor items seen during setup (Ran):

api.ts:117: app.listen has no error handler. With port 3000 taken, the API crashed with a raw Unhandled 'error' event (EADDRINUSE).
The draft README assumes bash: curl is an alias for Invoke-WebRequest in PowerShell, and it doesn't say Docker Desktop must be running.
3. Evidence log
Smoke test (Ran, 2026-11-17)
text
[api] published order 13be6665-f804-473f-a615-01cca1b47c53
[worker] received 13be6665-f804-473f-a615-01cca1b47c53 (tag 1, redelivered=false)
[worker] fulfilling 13be6665-f804-473f-a615-01cca1b47c53 (1 item(s)) for ~3184ms
[worker] ACK 13be6665-f804-473f-a615-01cca1b47c53

Status went queued to completed in about 3.2s. Port 3000 was taken by another local container, so this project runs on PORT=3001.

Burst test (Ran)

Five POSTs timed in PowerShell: 9, 7, 6, 5, 6 ms. The worker processed them one after another (tags 7-11, all redelivered=false, each with its own fulfilling and ACK; work times 3090-4643 ms). RabbitMQ queue graph: Total peaked at about 4 with Ready 3 and Unacked 1, draining to 0 in about 20 seconds.

Poison message test, before the fix (Ran)

Published not json through the RabbitMQ UI:

text
[worker] rejecting message (tag 13): message body is not valid JSON

The message was rejected with requeue=false and discarded. No second queue existed to hold it.

Crash test (Ran)

Order 8e7a6e43-22b7-4253-a211-8cb28f959278, worker force-killed mid-job. Status while the worker was dead: processing. After restart:

text
[worker] received 8e7a6e43-22b7-4253-a211-8cb28f959278 (tag 1, redelivered=true)
[worker] fulfilling 8e7a6e43-22b7-4253-a211-8cb28f959278 (1 item(s)) for ~3843ms
[worker] ACK 8e7a6e43-22b7-4253-a211-8cb28f959278

Final status: completed. No message was lost.

Duplicate delivery, before the fix (Ran)

The same order published again after it was completed:

text
[worker] received 8e7a6e43-22b7-4253-a211-8cb28f959278 (tag 2, redelivered=false)
[worker] fulfilling 8e7a6e43-22b7-4253-a211-8cb28f959278 (1 item(s)) for ~4022ms
[worker] ACK 8e7a6e43-22b7-4253-a211-8cb28f959278

The completed order was fulfilled a second time.

Duplicate delivery, after the fix (Ran, commit 5409044)

Order 0c3353ae-2769-486a-a391-d08becf0b30f completed normally, then the same order was published twice more:

text
[worker] received 0c3353ae-2769-486a-a391-d08becf0b30f (tag 1, redelivered=false)
[worker] fulfilling 0c3353ae-2769-486a-a391-d08becf0b30f (1 item(s)) for ~4435ms
[worker] ACK 0c3353ae-2769-486a-a391-d08becf0b30f
[worker] received 0c3353ae-2769-486a-a391-d08becf0b30f (tag 2, redelivered=false)
[worker] duplicate delivery of 0c3353ae-2769-486a-a391-d08becf0b30f: already completed, ACK and skip
[worker] received 0c3353ae-2769-486a-a391-d08becf0b30f (tag 3, redelivered=false)
[worker] duplicate delivery of 0c3353ae-2769-486a-a391-d08becf0b30f: already completed, ACK and skip

Neither duplicate reached fulfilling.

Dead-letter queue, after the fix (Ran, commit 9495e5b)

Broker state after the patched worker recreated the queue:

text
name                    arguments
orders.fulfillment.dlq  []
orders.fulfillment      [{"x-dead-letter-exchange","orders.dlx"},{"x-dead-letter-routing-key","orders.fulfillment"}]

After publishing not json again:

text
name                    messages
orders.fulfillment.dlq  1
orders.fulfillment      0

The rejected message is kept in the DLQ instead of being deleted. Normal orders still complete (for example 52e1d2bc-c6ed-42bc-9cd8-1fec9e2b1f61: completed in about 4.1s). TODO: payload screenshot from the RabbitMQ "Get messages" view in docs/.

Procedure note: RabbitMQ will not change the arguments of an existing queue, so the old queue had to be deleted once (rabbitmqctl delete_queue orders.fulfillment) before the patched code could recreate it. Until it was deleted, the worker kept using the old queue with no dead-letter settings.

4. Flaws found and what was done
#	Flaw	Evidence	Status	Commit
1	No dead-letter queue: malformed messages discarded	Ran	Fixed: dead-letter exchange orders.dlx + queue orders.fulfillment.dlq, bound with the queue's name as the routing key	9495e5b
2	No idempotency: duplicate delivery repeats the work	Ran	Fixed: the worker ACKs and skips orders already completed	5409044
3	Unlimited immediate requeue, no retry cap or backoff	Read	Not patched (known limitation)	n/a
4	Worker never sets failed; rejected orders have no terminal status	Read	Not patched (known limitation)	n/a
5	Status could go backwards (completed to processing) on duplicate	Read	Addressed by the guard in #2 (not separately reproduced)	5409044
5. Known limitations of the patched version
Idempotency is check-then-act. Two workers receiving the same order at the same moment could both pass the completed check. Production would use an atomic claim (for example Redis SET order:<id>:lock NX) or a unique constraint in the status store.
No retry cap. A message that always fails with a transient error is requeued forever. Production would count attempts and dead-letter after N tries, with backoff.
No failed status from the worker. Dead-lettered orders stay queued from the client's point of view; nothing consumes or alerts on the DLQ.
Single worker, no autoscaling. Throughput is one job at a time (prefetch(1)).
6. What the AI got right
Real external broker (RabbitMQ) and Redis status store, both in Docker Compose with healthchecks and volumes.
Durable queue and persistent messages; a message survived a hard worker kill.
Publisher confirms: 202 is returned only after the broker accepts the message.
Manual acknowledgments: noAck: false, ACK only after the work and the status update.
prefetch(1): one unacknowledged message per worker (confirmed in the burst test).
Input validation with 400 responses; idiomatic REST (202 with Location and a status URL, 404 for unknown orders, 503 when the publish fails).
Startup retry for the broker and exit-on-disconnect so a supervisor can restart the process.