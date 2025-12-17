import { Button } from '@/components/ui/button'
import Image from 'next/image'
import Link from 'next/link'

const notfound = () => {
  return (
    <div className='max-w-[1082px] mx-auto py-10 px-5'>
        <h1 className='text-2xl md:text-3xl lg:text-4xl font-semibold text-center text-content-dark'>Page Not Found</h1>
        <div className='flex justify-center mt-4'>
            <Link href="/"><Button className='px-8'>Go Home</Button></Link>
        </div>
        <div>
            <Image className='dark:hidden' src="/images/bg/not-found-light.png" alt="Not Found" width={1082} height={553}></Image>
            <Image className='hidden dark:block' src="/images/bg/not-found-dark.png" alt="Not Found" width={1082} height={553}></Image>
        </div>
    </div>
  )
}

export default notfound