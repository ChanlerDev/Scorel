# V2-M2: Multi-provider Routing

> capability-aware routing across providers and models

## Goal

Turn provider support from a manual configuration choice into an orchestration capability that balances capability, latency, and cost.

## Scope

- provider/model capability registry
- routing policy and heuristics
- fallback and failure handling
- cost/latency-aware model selection

## Dependencies

- multiple providers already production-usable
- telemetry and request accounting accurate enough to guide routing
