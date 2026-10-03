use assert_cmd::cargo::cargo_bin_cmd;
use predicates::prelude::*;

/// The binary with the color environment scrubbed, so a developer's
/// `CLICOLOR_FORCE` or `NO_COLOR` cannot change what a test sees.
fn lawbook() -> assert_cmd::Command {
    let mut command = cargo_bin_cmd!("lawbook");
    for name in ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"] {
        command.env_remove(name);
    }
    command
}

#[test]
fn no_arguments_succeeds() {
    lawbook().assert().success();
}

#[test]
fn version_prints_crate_version() {
    lawbook()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn help_names_the_binary() {
    lawbook()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Usage: lawbook"));
}

#[test]
fn unknown_flag_exits_two() {
    lawbook().arg("--no-such-flag").assert().code(2);
}
