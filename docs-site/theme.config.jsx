export default {
  logo: <strong>CAREL Protocol</strong>,
  project: {
    link: 'https://github.com/ntfound-dev/zkcarel_protocol',
  },
  docsRepositoryBase: 'https://github.com/ntfound-dev/zkcarel_protocol/tree/main/docs-site',
  footer: {
    text: 'CAREL Protocol — Privacy-first DeFi on Starknet',
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="CAREL Protocol documentation — privacy-first DeFi execution layer on Starknet" />
      <title>CAREL Protocol Docs</title>
    </>
  ),
  useNextSeoProps() {
    return {
      titleTemplate: '%s — CAREL Protocol',
    }
  },
  primaryHue: 210,
}
