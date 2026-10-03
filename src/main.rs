use anyhow::Result;
use clap::Parser;
use std::process::ExitCode;

#[derive(Debug, Parser)]
#[command(name = "lawbook", version, about = "lawbook command-line tool")]
struct Cli {}

fn run(_cli: &Cli) -> Result<()> {
    Ok(())
}

/// Exit codes: 0 success, 2 anything wrong with usage, input, or output.
/// Clap exits 2 on a bad argument by itself.
fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::from(2)
        }
    }
}
