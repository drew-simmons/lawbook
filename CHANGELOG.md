# Changelog

## 0.1.0 (2026-10-05)


### Features

* add a gitlab code quality output format ([#29](https://github.com/drew-simmons/lawbook/issues/29)) ([8e704bc](https://github.com/drew-simmons/lawbook/commit/8e704bce754a86f0583710c0f1c06fe32fd8e585))
* add a pre-commit hook definition ([#30](https://github.com/drew-simmons/lawbook/issues/30)) ([8bb848e](https://github.com/drew-simmons/lawbook/commit/8bb848e07a38526b238f3dc44cc7e5d9e2467050))
* add github and sarif output formats ([#18](https://github.com/drew-simmons/lawbook/issues/18)) ([941be3a](https://github.com/drew-simmons/lawbook/commit/941be3a238304ccc645e08449fbac3e9ec7d2765))
* add init and check commands with deterministic rules ([#7](https://github.com/drew-simmons/lawbook/issues/7)) ([5ce333f](https://github.com/drew-simmons/lawbook/commit/5ce333f916137b99779185d6ac09105fc0617ca0))
* add level: warn so a rule reports findings without failing ([#12](https://github.com/drew-simmons/lawbook/issues/12)) ([301db9d](https://github.com/drew-simmons/lawbook/commit/301db9dd592798dbef50b384b2eb339bb0be9abc))
* cache verdicts, the standard prompt, and report token usage ([#20](https://github.com/drew-simmons/lawbook/issues/20)) ([0c7402d](https://github.com/drew-simmons/lawbook/commit/0c7402d2ce248bfb550381772fd0c753bd17f5ee))
* cap model requests with llm.maxRequests ([#37](https://github.com/drew-simmons/lawbook/issues/37)) ([519e782](https://github.com/drew-simmons/lawbook/commit/519e7827c97c05c72c3fe69ef6c52c090e9dbd87))
* check only named or git-changed files ([#15](https://github.com/drew-simmons/lawbook/issues/15)) ([b4410f4](https://github.com/drew-simmons/lawbook/commit/b4410f45a1bfc1ac74c538ea712ecc03449c81eb))
* check standard rules against fixtures with lawbook test ([#38](https://github.com/drew-simmons/lawbook/issues/38)) ([730e819](https://github.com/drew-simmons/lawbook/commit/730e8191786272711e55b1660513b291b71f92eb))
* explain passing files with --explain ([#36](https://github.com/drew-simmons/lawbook/issues/36)) ([f2a7bed](https://github.com/drew-simmons/lawbook/commit/f2a7beda743b3af2600f8eed3a143ee79f56e77e))
* guard which files a rule reads ([#19](https://github.com/drew-simmons/lawbook/issues/19)) ([38187ad](https://github.com/drew-simmons/lawbook/commit/38187ad2f179019bd47a35ed157ac2e6b86d4c78))
* ignore known findings with a baseline file ([#32](https://github.com/drew-simmons/lawbook/issues/32)) ([4b66584](https://github.com/drew-simmons/lawbook/commit/4b665840f8f3fe6b4bfbc561ffdc6d76c5df873b))
* initial release ([#2](https://github.com/drew-simmons/lawbook/issues/2)) ([d43eb01](https://github.com/drew-simmons/lawbook/commit/d43eb01c17dd8f89940235ea95172c343568f34a))
* judge a set of files together with scope: set ([#24](https://github.com/drew-simmons/lawbook/issues/24)) ([0050607](https://github.com/drew-simmons/lawbook/commit/00506071264b74150ee178705bc7c222bceeb6c5))
* judge standard rules concurrently ([#13](https://github.com/drew-simmons/lawbook/issues/13)) ([aeae3d3](https://github.com/drew-simmons/lawbook/commit/aeae3d3592e45c4c2f292371728236c250aad6b0))
* judge standard rules through OpenAI and compatible endpoints ([#31](https://github.com/drew-simmons/lawbook/issues/31)) ([88af756](https://github.com/drew-simmons/lawbook/commit/88af756cc64a584638e7b03569cf7a284affa52b))
* judge standard rules through the Claude Code or Codex CLI ([#47](https://github.com/drew-simmons/lawbook/issues/47)) ([afd4188](https://github.com/drew-simmons/lawbook/commit/afd41887987f7a5240d5482d10773b1ec503dcec))
* judge standard rules with an LLM ([#8](https://github.com/drew-simmons/lawbook/issues/8)) ([c27ba44](https://github.com/drew-simmons/lawbook/commit/c27ba44abbbd97c17c9bb18416bb8d3fc1fc5dc8))
* let exists and absent take globs and lists ([#33](https://github.com/drew-simmons/lawbook/issues/33)) ([1242117](https://github.com/drew-simmons/lawbook/commit/124211744af94db2bfe4dc4d1d68b3bcad6583e2))
* list the files each rule would check with --dry-run ([#22](https://github.com/drew-simmons/lawbook/issues/22)) ([122d237](https://github.com/drew-simmons/lawbook/commit/122d237a6ba7ffee06bf15b26cf6a17088d8f003))
* name forbid and require findings with message ([#28](https://github.com/drew-simmons/lawbook/issues/28)) ([8ba8baa](https://github.com/drew-simmons/lawbook/commit/8ba8baa123fb70ce69152d9e91300176530748f7))
* pick a provider and model per standard rule ([#34](https://github.com/drew-simmons/lawbook/issues/34)) ([7c11802](https://github.com/drew-simmons/lawbook/commit/7c118021e27f0be83d03cccda6e1a8342b7ff998))
* publish a JSON Schema for lawbook.yaml ([#39](https://github.com/drew-simmons/lawbook/issues/39)) ([b7f503c](https://github.com/drew-simmons/lawbook/commit/b7f503c5fb6d64800d74200b10a80b827e2f43f8))
* report provider errors per file and keep going ([#14](https://github.com/drew-simmons/lawbook/issues/14)) ([537886c](https://github.com/drew-simmons/lawbook/commit/537886c4d12ce3a61bedc57a893c12734f62ffdc))
* report standard rule decisions in the Jev decision schema ([#11](https://github.com/drew-simmons/lawbook/issues/11)) ([5580bf3](https://github.com/drew-simmons/lawbook/commit/5580bf391348d747bd35f8ef72164c05562c4d21))
* send reference files as a standard rule's context ([#35](https://github.com/drew-simmons/lawbook/issues/35)) ([bbcc177](https://github.com/drew-simmons/lawbook/commit/bbcc177b3b79115d1308eac5857584080857b59d))
* share rule sets with extends ([#23](https://github.com/drew-simmons/lawbook/issues/23)) ([b2d58cd](https://github.com/drew-simmons/lawbook/commit/b2d58cd5e0218842d040d16fa918063e0183b41c))
* suppress a rule on a line or a file with lawbook comments ([#21](https://github.com/drew-simmons/lawbook/issues/21)) ([7976b29](https://github.com/drew-simmons/lawbook/commit/7976b2973f9a6351bec51f73ca8a3b5df169dde8))


### Bug Fixes

* handle CRLF and Windows paths, and test on windows-2022 ([#27](https://github.com/drew-simmons/lawbook/issues/27)) ([3dda764](https://github.com/drew-simmons/lawbook/commit/3dda7646bf685767eb0155966cf0ece72b521427))
* let exists and absent respect .gitignore, and name a missing OpenAI key ([#41](https://github.com/drew-simmons/lawbook/issues/41)) ([cb819ea](https://github.com/drew-simmons/lawbook/commit/cb819eaf7e71aa306403f74cb84746178449f5d0))
* reject region for the anthropic provider and out-of-range probabilities ([#17](https://github.com/drew-simmons/lawbook/issues/17)) ([80c0048](https://github.com/drew-simmons/lawbook/commit/80c0048fce3e1e3bc6ff8a66b08b73b435038c60))
