import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import dayjs from 'dayjs'
import dotenv from 'dotenv'

dotenv.config()
const secretManagerClient = new SecretManagerServiceClient()
const secretsPath = `projects/${
  process.env.GOOGLE_PROJECT_ID || 'bot-of-culture'
}/secrets/`

export function toNormalDate(timestamp: number | string | Date): string {
  return dayjs(timestamp).format('MMMM D, YYYY')
}

export async function getSecret(
  secretName: string,
  excludeEnv?: boolean,
): Promise<string> {
  let secretValue = process.env[secretName] ?? ''
  let environmentSuffix = '_' + (process.env.ENV ?? 'DEV')
  // Exclude environment from secret path
  if (excludeEnv) environmentSuffix = ''

  try {
    const [secret] = await secretManagerClient.accessSecretVersion({
      name: `${secretsPath}${secretName}${environmentSuffix}/versions/latest`,
    })

    const responsePayload = secret.payload.data.toString()

    if (!responsePayload) return process.env[secretName] ?? ''

    secretValue = responsePayload
  } catch (error) {
    console.error('Error retrieving secret: ', error)
    console.log('Attempting environment variable instead...')
  }

  return secretValue
}
