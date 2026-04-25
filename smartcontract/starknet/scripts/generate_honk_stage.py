#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path

from garaga.starknet.honk_contract_generator.generator_honk import gen_honk_verifier


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a Garaga Honk Cairo verifier stage package from a VK file."
    )
    parser.add_argument("--vk", required=True, help="Path to VK binary file")
    parser.add_argument("--out-dir", required=True, help="Parent directory for generated package")
    parser.add_argument("--project-name", required=True, help="Generated Scarb package name")
    parser.add_argument(
        "--force-clean",
        action="store_true",
        help="Delete existing project directory before generating",
    )
    args = parser.parse_args()

    vk_path = Path(args.vk).resolve()
    out_dir = Path(args.out_dir).resolve()
    project_dir = out_dir / args.project_name

    if not vk_path.is_file():
      raise SystemExit(f"VK file not found: {vk_path}")

    out_dir.mkdir(parents=True, exist_ok=True)
    if project_dir.exists():
        if not args.force_clean:
            raise SystemExit(
                f"Project already exists: {project_dir} (pass --force-clean to replace)"
            )
        shutil.rmtree(project_dir)

    gen_honk_verifier(
        vk=vk_path,
        output_folder_path=out_dir,
        output_folder_name=args.project_name,
        cli_mode=True,
        include_test_sample=True,
    )

    tool_versions = project_dir / ".tool-versions"
    tool_versions.write_text("scarb 2.16.1\nstarknet-foundry 0.57.0\n", encoding="ascii")

    print(f"Generated stage package: {project_dir}")


if __name__ == "__main__":
    main()
