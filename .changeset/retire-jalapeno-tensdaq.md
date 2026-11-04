---
"@read-frog/extension": minor
---

feat(providers): retire the Jalapeno Cloud and Tensdaq providers

Both shipped as sponsor cards, and v098 deliberately seeded Jalapeno into every
existing profile rather than only the ones that opted in. They are removed here
together with the Jalapeno partner bridge, the content script that had the
extension inject itself into `jalapeno-cloud.ai`. A new `v100-to-v101` config
migration drops the two providers and reassigns any feature pointing at them to
the first enabled LLM provider, or to the built-in AI when none is left, so
stored profiles keep validating instead of falling back to the defaults.
