port module Doubler exposing (main)


port input : (Int -> msg) -> Sub msg


port output : Int -> Cmd msg


main : Program Int Int Int
main =
    Platform.worker
        { init = \factor -> ( factor, Cmd.none )
        , update = \value factor -> ( factor, output (value * factor) )
        , subscriptions = \_ -> input identity
        }
